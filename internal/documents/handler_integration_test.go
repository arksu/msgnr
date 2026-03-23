//go:build integration

package documents

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"msgnr/internal/auth"
	"msgnr/internal/testdb"
)

func seedHandlerUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, displayName string) uuid.UUID {
	t.Helper()
	email := "handler_delete_teamspace_" + uuid.NewString() + "@example.com"
	var id uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', $2, 'member')
		 RETURNING id`,
		email,
		displayName,
	).Scan(&id); err != nil {
		t.Fatalf("seed user %s: %v", email, err)
	}
	return id
}

func TestHandler_DeleteTeamspace(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	h := NewHandler(svc, nil, zap.NewNop(), 50)

	ownerID := seedHandlerUser(t, ctx, pool, "Owner")

	teamspace, err := svc.CreateTeamspace(ctx, CreateTeamspaceParams{
		Name:    "Handler delete",
		ActorID: ownerID,
	}, "member")
	if err != nil {
		t.Fatalf("create teamspace: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/documents/teamspaces/"+teamspace.ID.String(), nil)
	rec := httptest.NewRecorder()
	h.teamspaceItem(rec, req, auth.Principal{UserID: ownerID, Role: "member"}, teamspace.ID)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
}

func TestHandler_DeleteTeamspaceForbidden(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	h := NewHandler(svc, nil, zap.NewNop(), 50)

	ownerID := seedHandlerUser(t, ctx, pool, "Owner")
	outsiderID := seedHandlerUser(t, ctx, pool, "Outsider")

	teamspace, err := svc.CreateTeamspace(ctx, CreateTeamspaceParams{
		Name:    "Handler delete forbidden",
		ActorID: ownerID,
	}, "member")
	if err != nil {
		t.Fatalf("create teamspace: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/documents/teamspaces/"+teamspace.ID.String(), nil)
	rec := httptest.NewRecorder()
	h.teamspaceItem(rec, req, auth.Principal{UserID: outsiderID, Role: "member"}, teamspace.ID)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}
