//go:build integration

package documents_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"msgnr/internal/documents"
	"msgnr/internal/testdb"
)

func seedDocumentUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, displayName, role string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if role == "" {
		role = "member"
	}
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', $2, $3)
		 RETURNING id`,
		"documents_test_"+uuid.NewString()+"@example.com",
		displayName,
		role,
	).Scan(&id)
	require.NoError(t, err)
	return id
}

func TestIntegration_ListTeamspacesVisibilityAndJoin(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := documents.NewService(pool)

	ownerID := seedDocumentUser(t, ctx, pool, "Owner", "member")
	memberID := seedDocumentUser(t, ctx, pool, "Member", "member")
	outsiderID := seedDocumentUser(t, ctx, pool, "Outsider", "member")

	publicSpace, err := svc.CreateTeamspace(ctx, documents.CreateTeamspaceParams{
		Name:      "Public space",
		MemberIDs: []uuid.UUID{memberID},
		ActorID:   ownerID,
	}, "member")
	require.NoError(t, err)

	_, err = svc.CreateTeamspace(ctx, documents.CreateTeamspaceParams{
		Name:      "Private space",
		IsPrivate: true,
		ActorID:   ownerID,
	}, "member")
	require.NoError(t, err)

	rows, err := svc.ListTeamspaces(ctx, outsiderID, "member")
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, publicSpace.ID, rows[0].ID)
	assert.False(t, rows[0].IsMember)
	assert.Equal(t, 2, rows[0].MemberCount)

	joined, err := svc.JoinTeamspace(ctx, publicSpace.ID, outsiderID, "member")
	require.NoError(t, err)
	assert.True(t, joined.IsMember)

	rows, err = svc.ListTeamspaces(ctx, outsiderID, "member")
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.True(t, rows[0].IsMember)
	assert.Equal(t, 3, rows[0].MemberCount)
}

func TestIntegration_SidebarHierarchyMemberOnly(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := documents.NewService(pool)

	ownerID := seedDocumentUser(t, ctx, pool, "Owner", "member")
	memberID := seedDocumentUser(t, ctx, pool, "Member", "member")
	outsiderID := seedDocumentUser(t, ctx, pool, "Outsider", "member")

	teamspace, err := svc.CreateTeamspace(ctx, documents.CreateTeamspaceParams{
		Name:      "Docs",
		MemberIDs: []uuid.UUID{memberID},
		ActorID:   ownerID,
	}, "member")
	require.NoError(t, err)

	rootDoc, err := svc.CreateDocument(ctx, documents.CreateDocumentParams{
		TeamspaceID: teamspace.ID,
		Title:       "Root doc",
		ActorID:     ownerID,
	})
	require.NoError(t, err)

	_, err = svc.CreateDocument(ctx, documents.CreateDocumentParams{
		TeamspaceID:      teamspace.ID,
		ParentDocumentID: &rootDoc.ID,
		Title:            "Child doc",
		ActorID:          memberID,
	})
	require.NoError(t, err)

	sidebar, err := svc.ListSidebar(ctx, memberID)
	require.NoError(t, err)
	require.Len(t, sidebar, 1)
	require.Len(t, sidebar[0].Documents, 1)
	assert.Equal(t, "Root doc", sidebar[0].Documents[0].Title)
	require.Len(t, sidebar[0].Documents[0].Children, 1)
	assert.Equal(t, "Child doc", sidebar[0].Documents[0].Children[0].Title)

	sidebar, err = svc.ListSidebar(ctx, outsiderID)
	require.NoError(t, err)
	assert.Empty(t, sidebar)
}

func TestIntegration_DocumentMemberEditAndNonMemberForbidden(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := documents.NewService(pool)

	ownerID := seedDocumentUser(t, ctx, pool, "Owner", "member")
	memberID := seedDocumentUser(t, ctx, pool, "Member", "member")
	outsiderID := seedDocumentUser(t, ctx, pool, "Outsider", "member")

	teamspace, err := svc.CreateTeamspace(ctx, documents.CreateTeamspaceParams{
		Name:      "Shared docs",
		MemberIDs: []uuid.UUID{memberID},
		ActorID:   ownerID,
	}, "member")
	require.NoError(t, err)

	doc, err := svc.CreateDocument(ctx, documents.CreateDocumentParams{
		TeamspaceID:     teamspace.ID,
		Title:           "Shared note",
		ContentMarkdown: ptr("first"),
		ActorID:         ownerID,
	})
	require.NoError(t, err)

	updated, err := svc.UpdateDocument(ctx, doc.ID, documents.UpdateDocumentParams{
		ContentMarkdown: ptr("second"),
		ActorID:         memberID,
	})
	require.NoError(t, err)
	require.NotNil(t, updated.ContentMarkdown)
	assert.Equal(t, "second", *updated.ContentMarkdown)
	assert.Equal(t, memberID, updated.UpdatedBy)

	_, err = svc.GetDocument(ctx, doc.ID, outsiderID)
	require.ErrorIs(t, err, documents.ErrForbidden)

	_, err = svc.UpdateDocument(ctx, doc.ID, documents.UpdateDocumentParams{
		ContentMarkdown: ptr("third"),
		ActorID:         outsiderID,
	})
	require.ErrorIs(t, err, documents.ErrForbidden)
}

func TestIntegration_DocumentHistoryDeduplicatesAndPrunes(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := documents.NewService(pool)
	svc.SetHistoryLimit(3)

	ownerID := seedDocumentUser(t, ctx, pool, "Owner", "member")
	teamspace, err := svc.CreateTeamspace(ctx, documents.CreateTeamspaceParams{
		Name:    "History docs",
		ActorID: ownerID,
	}, "member")
	require.NoError(t, err)

	doc, err := svc.CreateDocument(ctx, documents.CreateDocumentParams{
		TeamspaceID:     teamspace.ID,
		Title:           "v1",
		ContentMarkdown: ptr("one"),
		ActorID:         ownerID,
	})
	require.NoError(t, err)

	_, err = svc.UpdateDocument(ctx, doc.ID, documents.UpdateDocumentParams{
		ContentMarkdown: ptr("one"),
		ActorID:         ownerID,
	})
	require.NoError(t, err)

	_, err = svc.UpdateDocument(ctx, doc.ID, documents.UpdateDocumentParams{
		Title:   ptr("v2"),
		ActorID: ownerID,
	})
	require.NoError(t, err)

	_, err = svc.UpdateDocument(ctx, doc.ID, documents.UpdateDocumentParams{
		ContentMarkdown: ptr("two"),
		ActorID:         ownerID,
	})
	require.NoError(t, err)

	_, err = svc.UpdateDocument(ctx, doc.ID, documents.UpdateDocumentParams{
		ContentMarkdown: ptr("three"),
		ActorID:         ownerID,
	})
	require.NoError(t, err)

	history, err := svc.ListDocumentHistory(ctx, doc.ID, ownerID)
	require.NoError(t, err)
	require.Len(t, history, 3)
	assert.Equal(t, "v2", history[0].Title)
	require.NotNil(t, history[0].ContentMarkdown)
	assert.Equal(t, "three", *history[0].ContentMarkdown)
	require.NotNil(t, history[1].ContentMarkdown)
	assert.Equal(t, "two", *history[1].ContentMarkdown)
	assert.Equal(t, "v2", history[1].Title)
	assert.Equal(t, "v2", history[2].Title)
	require.NotNil(t, history[2].ContentMarkdown)
	assert.Equal(t, "one", *history[2].ContentMarkdown)
}

func TestIntegration_DeleteDocumentArchivesSubtree(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := documents.NewService(pool)

	ownerID := seedDocumentUser(t, ctx, pool, "Owner", "member")
	outsiderID := seedDocumentUser(t, ctx, pool, "Outsider", "member")

	teamspace, err := svc.CreateTeamspace(ctx, documents.CreateTeamspaceParams{
		Name:    "Delete docs",
		ActorID: ownerID,
	}, "member")
	require.NoError(t, err)

	rootDoc, err := svc.CreateDocument(ctx, documents.CreateDocumentParams{
		TeamspaceID: teamspace.ID,
		Title:       "Root doc",
		ActorID:     ownerID,
	})
	require.NoError(t, err)

	childDoc, err := svc.CreateDocument(ctx, documents.CreateDocumentParams{
		TeamspaceID:      teamspace.ID,
		ParentDocumentID: &rootDoc.ID,
		Title:            "Child doc",
		ActorID:          ownerID,
	})
	require.NoError(t, err)

	grandchildDoc, err := svc.CreateDocument(ctx, documents.CreateDocumentParams{
		TeamspaceID:      teamspace.ID,
		ParentDocumentID: &childDoc.ID,
		Title:            "Grandchild doc",
		ActorID:          ownerID,
	})
	require.NoError(t, err)

	err = svc.DeleteDocument(ctx, rootDoc.ID, ownerID)
	require.NoError(t, err)

	sidebar, err := svc.ListSidebar(ctx, ownerID)
	require.NoError(t, err)
	require.Len(t, sidebar, 1)
	assert.Empty(t, sidebar[0].Documents)

	_, err = svc.GetDocument(ctx, rootDoc.ID, ownerID)
	require.ErrorIs(t, err, documents.ErrNotFound)
	_, err = svc.GetDocument(ctx, childDoc.ID, ownerID)
	require.ErrorIs(t, err, documents.ErrNotFound)
	_, err = svc.GetDocument(ctx, grandchildDoc.ID, ownerID)
	require.ErrorIs(t, err, documents.ErrNotFound)

	err = svc.DeleteDocument(ctx, rootDoc.ID, outsiderID)
	require.ErrorIs(t, err, documents.ErrNotFound)
}

func ptr(value string) *string {
	return &value
}
