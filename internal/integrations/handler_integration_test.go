//go:build integration

package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"msgnr/internal/documents"
	"msgnr/internal/tasks"
	"msgnr/internal/testdb"
)

func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, role, status string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role, status)
		 VALUES ($1, 'x', $2, $3, $4)
		 RETURNING id`,
		"integration_"+uuid.NewString()+"@example.com",
		role+" user",
		role,
		status,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return id
}

func seedToken(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, raw string, revoked bool) {
	t.Helper()
	var revokedAt any
	if revoked {
		revokedAt = time.Now().UTC()
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO integration_token (user_id, token_hash, revoked_at)
		 VALUES ($1, $2, $3)`,
		userID,
		hashToken(raw),
		revokedAt,
	); err != nil {
		t.Fatalf("seed token: %v", err)
	}
}

func newHandler(pool *pgxpool.Pool) *Handler {
	taskSvc := tasks.NewService(pool, nil)
	documentSvc := documents.NewService(pool, nil)
	return NewHandler(NewService(pool, taskSvc, documentSvc, zap.NewNop()), zap.NewNop())
}

func newMux(pool *pgxpool.Pool) *http.ServeMux {
	mux := http.NewServeMux()
	newHandler(pool).RegisterRoutes(mux)
	return mux
}

func seedTask(t *testing.T, ctx context.Context, pool *pgxpool.Pool, actorID uuid.UUID) tasks.TaskResponse {
	t.Helper()
	svc := tasks.NewService(pool, nil)
	template, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{
		Prefix:    "INT",
		SortOrder: 1,
		ActorID:   actorID,
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	status, err := svc.CreateStatus(ctx, tasks.CreateStatusParams{
		Code:      "open",
		Name:      "Open",
		SortOrder: 1,
		ActorID:   actorID,
	})
	if err != nil {
		t.Fatalf("create status: %v", err)
	}
	field, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: template.ID,
		Code:       "summary",
		Name:       "Summary",
		Type:       "text",
		Required:   true,
		SortOrder:  1,
	})
	if err != nil {
		t.Fatalf("create field: %v", err)
	}
	description := "Task description"
	value := "Field value"
	taskRow, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID:  template.ID,
		Title:       "Integration task",
		Description: &description,
		StatusID:    status.ID,
		FieldValues: []tasks.FieldValueInput{{
			FieldDefinitionID: field.ID,
			ValueText:         &value,
		}},
		ActorID: actorID,
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	return taskRow
}

func seedTeamspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID uuid.UUID, memberIDs ...uuid.UUID) documents.TeamspaceRow {
	t.Helper()
	svc := documents.NewService(pool, nil)
	row, err := svc.CreateTeamspace(ctx, documents.CreateTeamspaceParams{
		Name:      "Docs " + uuid.NewString(),
		MemberIDs: memberIDs,
		ActorID:   ownerID,
	}, "member")
	if err != nil {
		t.Fatalf("create teamspace: %v", err)
	}
	return row
}

func seedDocument(t *testing.T, ctx context.Context, pool *pgxpool.Pool, actorID, teamspaceID uuid.UUID, parentID *uuid.UUID, title string) documents.DocumentResponse {
	t.Helper()
	svc := documents.NewService(pool, nil)
	description := title + " description"
	row, err := svc.CreateDocument(ctx, documents.CreateDocumentParams{
		TeamspaceID:      teamspaceID,
		ParentDocumentID: parentID,
		Title:            title,
		ContentMarkdown:  &description,
		ActorID:          actorID,
	})
	if err != nil {
		t.Fatalf("create document: %v", err)
	}
	return row
}

func TestHandler_GetTaskByPublicID(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	mux := newMux(pool)

	actorID := seedUser(t, ctx, pool, "admin", "active")
	botID := seedUser(t, ctx, pool, "bot", "active")
	seedToken(t, ctx, pool, botID, "task-token", false)
	taskRow := seedTask(t, ctx, pool, actorID)

	req := httptest.NewRequest(http.MethodGet, "/api/integrations/tasks/"+taskRow.PublicID, nil)
	req.Header.Set("Authorization", "Bearer task-token")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp integrationTaskResponseDTO
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Title != taskRow.Title {
		t.Fatalf("expected title %q, got %q", taskRow.Title, resp.Title)
	}
	if resp.Description == nil || *resp.Description != "Task description" {
		t.Fatalf("expected description to map, got %+v", resp.Description)
	}
	if len(resp.Fields) != 1 {
		t.Fatalf("expected one field, got %d", len(resp.Fields))
	}
	if resp.Fields[0].Code != "summary" || resp.Fields[0].ValueText == nil || *resp.Fields[0].ValueText != "Field value" {
		t.Fatalf("expected field metadata and value to map, got %+v", resp.Fields[0])
	}
}

func TestHandler_GetTaskByPublicIDNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	mux := newMux(pool)

	botID := seedUser(t, ctx, pool, "bot", "active")
	seedToken(t, ctx, pool, botID, "task-token", false)

	req := httptest.NewRequest(http.MethodGet, "/api/integrations/tasks/INT-999", nil)
	req.Header.Set("Authorization", "Bearer task-token")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_IntegrationTokenAuthFailures(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	mux := newMux(pool)

	actorID := seedUser(t, ctx, pool, "admin", "active")
	taskRow := seedTask(t, ctx, pool, actorID)

	revokedBotID := seedUser(t, ctx, pool, "bot", "active")
	blockedBotID := seedUser(t, ctx, pool, "bot", "blocked")
	memberID := seedUser(t, ctx, pool, "member", "active")
	seedToken(t, ctx, pool, revokedBotID, "revoked-token", true)
	seedToken(t, ctx, pool, blockedBotID, "blocked-token", false)
	seedToken(t, ctx, pool, memberID, "member-token", false)

	testCases := []struct {
		name  string
		token string
	}{
		{name: "unknown token", token: "missing-token"},
		{name: "revoked token", token: "revoked-token"},
		{name: "blocked bot token", token: "blocked-token"},
		{name: "non-bot token", token: "member-token"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/integrations/tasks/"+taskRow.PublicID, nil)
			req.Header.Set("Authorization", "Bearer "+tc.token)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestHandler_CreateAndGetDocument(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	mux := newMux(pool)

	ownerID := seedUser(t, ctx, pool, "member", "active")
	botID := seedUser(t, ctx, pool, "bot", "active")
	seedToken(t, ctx, pool, botID, "doc-token", false)
	teamspace := seedTeamspace(t, ctx, pool, ownerID, botID)

	body := bytes.NewBufferString(`{"title":"Spec","description":"Document body","parent_id":null,"teamspace_id":"` + teamspace.ID.String() + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/integrations/documents", body)
	req.Header.Set("Authorization", "Bearer doc-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var created integrationDocumentResponseDTO
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Title != "Spec" || created.Description == nil || *created.Description != "Document body" {
		t.Fatalf("unexpected create response: %+v", created)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/integrations/documents/"+created.ID.String(), nil)
	getReq.Header.Set("Authorization", "Bearer doc-token")
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", getRec.Code, getRec.Body.String())
	}

	var fetched integrationDocumentResponseDTO
	if err := json.NewDecoder(getRec.Body).Decode(&fetched); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	if fetched.ID != created.ID || fetched.Title != created.Title {
		t.Fatalf("unexpected fetched document: %+v", fetched)
	}
}

func TestHandler_CreateDocumentRejectsParentTeamspaceMismatch(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	mux := newMux(pool)

	ownerID := seedUser(t, ctx, pool, "member", "active")
	botID := seedUser(t, ctx, pool, "bot", "active")
	seedToken(t, ctx, pool, botID, "doc-token", false)
	teamspaceA := seedTeamspace(t, ctx, pool, ownerID, botID)
	teamspaceB := seedTeamspace(t, ctx, pool, ownerID, botID)
	parent := seedDocument(t, ctx, pool, ownerID, teamspaceA.ID, nil, "Parent")

	body := bytes.NewBufferString(`{"title":"Child","description":"Bad","parent_id":"` + parent.ID.String() + `","teamspace_id":"` + teamspaceB.ID.String() + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/integrations/documents", body)
	req.Header.Set("Authorization", "Bearer doc-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_GetDocumentForbiddenWhenBotNotMember(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	mux := newMux(pool)

	ownerID := seedUser(t, ctx, pool, "member", "active")
	botID := seedUser(t, ctx, pool, "bot", "active")
	seedToken(t, ctx, pool, botID, "doc-token", false)
	teamspace := seedTeamspace(t, ctx, pool, ownerID)
	document := seedDocument(t, ctx, pool, ownerID, teamspace.ID, nil, "Hidden")

	req := httptest.NewRequest(http.MethodGet, "/api/integrations/documents/"+document.ID.String(), nil)
	req.Header.Set("Authorization", "Bearer doc-token")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}
