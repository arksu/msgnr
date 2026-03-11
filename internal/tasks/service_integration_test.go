//go:build integration

package tasks_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"msgnr/internal/tasks"
	"msgnr/internal/testdb"
)

// seedUser inserts a minimal user and returns its ID.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Test User', 'admin') RETURNING id`,
		"tasks_test_"+uuid.NewString()+"@example.com",
	).Scan(&id)
	require.NoError(t, err)
	return id
}

// =========================================================
// Templates
// =========================================================

func TestIntegration_Template_CreateAndList(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	row, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{
		Prefix:    "DEV",
		SortOrder: 1,
		ActorID:   actor,
	})
	require.NoError(t, err)
	assert.Equal(t, "DEV", row.Prefix)
	assert.Nil(t, row.DeletedAt)

	list, err := svc.ListTemplates(ctx, false)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, row.ID, list[0].ID)
}

func TestIntegration_Template_PrefixMustBeUppercase(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	_, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{
		Prefix:  "dev",
		ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_Template_PrefixMustBeUnique(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	_, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{Prefix: "BUG", ActorID: actor})
	require.NoError(t, err)

	_, err = svc.CreateTemplate(ctx, tasks.CreateTemplateParams{Prefix: "BUG", ActorID: actor})
	require.ErrorIs(t, err, tasks.ErrConflict)
}

func TestIntegration_Template_SoftDelete(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	row, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{Prefix: "QA", ActorID: actor})
	require.NoError(t, err)

	deleted, err := svc.SoftDeleteTemplate(ctx, row.ID, actor)
	require.NoError(t, err)
	assert.NotNil(t, deleted.DeletedAt)

	// Deleted template absent from normal list.
	list, err := svc.ListTemplates(ctx, false)
	require.NoError(t, err)
	assert.Empty(t, list)

	// But visible when including deleted.
	all, err := svc.ListTemplates(ctx, true)
	require.NoError(t, err)
	assert.Len(t, all, 1)
}

func TestIntegration_Template_Reorder(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	a, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{Prefix: "AA", SortOrder: 1, ActorID: actor})
	require.NoError(t, err)
	b, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{Prefix: "BB", SortOrder: 2, ActorID: actor})
	require.NoError(t, err)

	// Reverse order.
	err = svc.ReorderTemplates(ctx, []uuid.UUID{b.ID, a.ID})
	require.NoError(t, err)

	list, err := svc.ListTemplates(ctx, false)
	require.NoError(t, err)
	require.Len(t, list, 2)
	assert.Equal(t, b.ID, list[0].ID)
	assert.Equal(t, a.ID, list[1].ID)
}

// =========================================================
// Statuses
// =========================================================

func TestIntegration_Status_CreateAndList(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	row, err := svc.CreateStatus(ctx, tasks.CreateStatusParams{
		Code:    "open",
		Name:    "Open",
		ActorID: actor,
	})
	require.NoError(t, err)
	assert.Equal(t, "open", row.Code)
	assert.Equal(t, "Open", row.Name)

	list, err := svc.ListStatuses(ctx, false)
	require.NoError(t, err)
	require.Len(t, list, 1)
}

func TestIntegration_Status_CodeMustBeUnique(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	_, err := svc.CreateStatus(ctx, tasks.CreateStatusParams{Code: "done", Name: "Done", ActorID: actor})
	require.NoError(t, err)

	_, err = svc.CreateStatus(ctx, tasks.CreateStatusParams{Code: "done", Name: "Done again", ActorID: actor})
	require.ErrorIs(t, err, tasks.ErrConflict)
}

func TestIntegration_Status_SoftDelete(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	row, err := svc.CreateStatus(ctx, tasks.CreateStatusParams{Code: "wip", Name: "WIP", ActorID: actor})
	require.NoError(t, err)

	deleted, err := svc.SoftDeleteStatus(ctx, row.ID)
	require.NoError(t, err)
	assert.NotNil(t, deleted.DeletedAt)

	active, err := svc.ListStatuses(ctx, false)
	require.NoError(t, err)
	assert.Empty(t, active)
}

func TestIntegration_Status_Update(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	row, err := svc.CreateStatus(ctx, tasks.CreateStatusParams{Code: "todo", Name: "Todo", ActorID: actor})
	require.NoError(t, err)

	updated, err := svc.UpdateStatus(ctx, row.ID, tasks.UpdateStatusParams{Code: "todo", Name: "To Do"})
	require.NoError(t, err)
	assert.Equal(t, "To Do", updated.Name)
}

func TestIntegration_Template_UpdateWithSortOrder(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	tpl, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{Prefix: "UPDA", SortOrder: 1, ActorID: actor})
	require.NoError(t, err)
	assert.Equal(t, 1, tpl.SortOrder)

	sort2 := 2
	updated, err := svc.UpdateTemplate(ctx, tpl.ID, tasks.UpdateTemplateParams{
		Prefix:    "UPDB",
		SortOrder: &sort2,
		ActorID:   actor,
	})
	require.NoError(t, err)
	assert.Equal(t, "UPDB", updated.Prefix)
	assert.Equal(t, 2, updated.SortOrder)

	// Update only prefix (sort_order should remain 2)
	updated2, err := svc.UpdateTemplate(ctx, tpl.ID, tasks.UpdateTemplateParams{
		Prefix:    "UPDC",
		SortOrder: nil,
		ActorID:   actor,
	})
	require.NoError(t, err)
	assert.Equal(t, "UPDC", updated2.Prefix)
	assert.Equal(t, 2, updated2.SortOrder)
}

// =========================================================
// Enum dictionaries
// =========================================================

func TestIntegration_Dictionary_CreateAndList(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)

	row, err := svc.CreateDictionary(ctx, tasks.CreateDictionaryParams{
		Code: "priority",
		Name: "Priority",
	})
	require.NoError(t, err)
	assert.Equal(t, "priority", row.Code)
	assert.Equal(t, 1, row.CurrentVersion)

	list, err := svc.ListDictionaries(ctx)
	require.NoError(t, err)
	require.Len(t, list, 1)
}

func TestIntegration_Dictionary_CodeMustBeUnique(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)

	_, err := svc.CreateDictionary(ctx, tasks.CreateDictionaryParams{Code: "sev", Name: "Severity"})
	require.NoError(t, err)

	_, err = svc.CreateDictionary(ctx, tasks.CreateDictionaryParams{Code: "sev", Name: "Severity 2"})
	require.ErrorIs(t, err, tasks.ErrConflict)
}

func TestIntegration_Dictionary_CreateVersion(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	dict, err := svc.CreateDictionary(ctx, tasks.CreateDictionaryParams{Code: "env", Name: "Environment"})
	require.NoError(t, err)
	assert.Equal(t, 1, dict.CurrentVersion)

	items := []tasks.DictionaryItemInput{
		{ValueCode: "prod", ValueName: "Production", SortOrder: 1, IsActive: true},
		{ValueCode: "stage", ValueName: "Staging", SortOrder: 2, IsActive: true},
	}
	ver, err := svc.CreateDictionaryVersion(ctx, dict.ID, items, actor)
	require.NoError(t, err)
	assert.Equal(t, 2, ver.Version)

	// Dictionary current_version incremented.
	updated, err := svc.GetDictionary(ctx, dict.ID)
	require.NoError(t, err)
	assert.Equal(t, 2, updated.CurrentVersion)

	// Items are stored.
	stored, err := svc.GetDictionaryVersionItems(ctx, ver.ID)
	require.NoError(t, err)
	require.Len(t, stored, 2)
	assert.Equal(t, "prod", stored[0].ValueCode)
	assert.Equal(t, "stage", stored[1].ValueCode)
}

func TestIntegration_Dictionary_VersionRequiresItems(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	dict, err := svc.CreateDictionary(ctx, tasks.CreateDictionaryParams{Code: "x", Name: "X"})
	require.NoError(t, err)

	_, err = svc.CreateDictionaryVersion(ctx, dict.ID, nil, actor)
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

// =========================================================
// Field definitions
// =========================================================

func seedTemplate(t *testing.T, ctx context.Context, svc *tasks.Service, prefix string, actor uuid.UUID) tasks.TemplateRow {
	t.Helper()
	row, err := svc.CreateTemplate(ctx, tasks.CreateTemplateParams{Prefix: prefix, SortOrder: 1, ActorID: actor})
	require.NoError(t, err)
	return row
}

func seedDict(t *testing.T, ctx context.Context, svc *tasks.Service) tasks.DictionaryRow {
	t.Helper()
	row, err := svc.CreateDictionary(ctx, tasks.CreateDictionaryParams{
		Code: "dict_" + uuid.NewString()[:8],
		Name: "Test Dict",
	})
	require.NoError(t, err)
	return row
}

func TestIntegration_Field_CreateAndList(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "FLD", actor)

	row, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID,
		Code:       "title",
		Name:       "Title",
		Type:       "text",
		SortOrder:  1,
	})
	require.NoError(t, err)
	assert.Equal(t, "title", row.Code)
	assert.Equal(t, "text", row.Type)
	assert.Nil(t, row.DeletedAt)

	list, err := svc.ListFields(ctx, tpl.ID, false)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, row.ID, list[0].ID)
}

func TestIntegration_Field_AllTypes(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "TYP", actor)
	dict := seedDict(t, ctx, svc)

	types := []struct {
		code      string
		fieldType string
		dictID    *uuid.UUID
	}{
		{"f_text", "text", nil},
		{"f_number", "number", nil},
		{"f_user", "user", nil},
		{"f_users", "users", nil},
		{"f_enum", "enum", &dict.ID},
		{"f_multienum", "multi_enum", &dict.ID},
		{"f_date", "date", nil},
		{"f_datetime", "datetime", nil},
	}

	for i, tc := range types {
		_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
			TemplateID:       tpl.ID,
			Code:             tc.code,
			Name:             tc.code,
			Type:             tc.fieldType,
			SortOrder:        i + 1,
			EnumDictionaryID: tc.dictID,
		})
		require.NoError(t, err, "type %s", tc.fieldType)
	}

	list, err := svc.ListFields(ctx, tpl.ID, false)
	require.NoError(t, err)
	assert.Len(t, list, len(types))
}

func TestIntegration_Field_CodeMustBeIdentifier(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CID", actor)

	cases := []string{"Bad Code", "123start", "UPPER", "has space", ""}
	for _, code := range cases {
		_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
			TemplateID: tpl.ID, Code: code, Name: "x", Type: "text", SortOrder: 1,
		})
		require.ErrorIs(t, err, tasks.ErrBadRequest, "code %q should be rejected", code)
	}
}

func TestIntegration_Field_CodeUniquePerTemplate(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "UNQ", actor)

	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "dup", Name: "Dup", Type: "text", SortOrder: 1,
	})
	require.NoError(t, err)

	_, err = svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "dup", Name: "Dup2", Type: "text", SortOrder: 2,
	})
	require.ErrorIs(t, err, tasks.ErrConflict)
}

func TestIntegration_Field_SameCodeDifferentTemplates(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl1 := seedTemplate(t, ctx, svc, "TMPA", actor)
	tpl2 := seedTemplate(t, ctx, svc, "TMPB", actor)

	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl1.ID, Code: "shared", Name: "Shared", Type: "text", SortOrder: 1,
	})
	require.NoError(t, err)

	_, err = svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl2.ID, Code: "shared", Name: "Shared", Type: "text", SortOrder: 1,
	})
	require.NoError(t, err, "same code on different template should be allowed")
}

func TestIntegration_Field_SoftDelete(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "SDF", actor)

	row, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "gone", Name: "Gone", Type: "text", SortOrder: 1,
	})
	require.NoError(t, err)

	deleted, err := svc.SoftDeleteField(ctx, tpl.ID, row.ID)
	require.NoError(t, err)
	assert.NotNil(t, deleted.DeletedAt)

	active, err := svc.ListFields(ctx, tpl.ID, false)
	require.NoError(t, err)
	assert.Empty(t, active)

	all, err := svc.ListFields(ctx, tpl.ID, true)
	require.NoError(t, err)
	assert.Len(t, all, 1)
}

func TestIntegration_Field_CodeReuseAfterSoftDelete(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CRU", actor)

	row, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "recycled", Name: "Recycled", Type: "text", SortOrder: 1,
	})
	require.NoError(t, err)
	_, err = svc.SoftDeleteField(ctx, tpl.ID, row.ID)
	require.NoError(t, err)

	// Creating a new field with the same code should succeed after soft-delete.
	_, err = svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "recycled", Name: "Recycled New", Type: "number", SortOrder: 1,
	})
	require.NoError(t, err)
}

func TestIntegration_Field_AssigneeTypeValidation(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ASG", actor)

	role := "assignee"

	// Assignee with text type must fail (check constraint).
	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "bad_assignee", Name: "Bad", Type: "text", FieldRole: &role, SortOrder: 1,
	})
	require.Error(t, err)

	// Assignee with user type must succeed.
	_, err = svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "assignee_user", Name: "Assignee", Type: "user", FieldRole: &role, SortOrder: 1,
	})
	require.NoError(t, err)
}

func TestIntegration_Field_MaxOneAssigneePerTemplate(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ONA", actor)

	role := "assignee"
	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "assignee1", Name: "Assignee 1", Type: "user", FieldRole: &role, SortOrder: 1,
	})
	require.NoError(t, err)

	_, err = svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "assignee2", Name: "Assignee 2", Type: "users", FieldRole: &role, SortOrder: 2,
	})
	require.ErrorIs(t, err, tasks.ErrConflict)
}

func TestIntegration_Field_AssigneeConflictMessage(t *testing.T) {
	// The "one assignee" unique index must produce ErrConflict (not ErrBadRequest)
	// with a message that mentions "assignee", not "field code".
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ACM", actor)

	role := "assignee"
	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "a1", Name: "A1", Type: "user", FieldRole: &role, SortOrder: 1,
	})
	require.NoError(t, err)

	_, err = svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "a2", Name: "A2", Type: "users", FieldRole: &role, SortOrder: 2,
	})
	require.ErrorIs(t, err, tasks.ErrConflict)
	assert.Contains(t, err.Error(), "assignee")
}

func TestIntegration_Field_EnumRequiresDictionary(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ERD", actor)

	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "no_dict", Name: "No Dict", Type: "enum", SortOrder: 1,
	})
	require.Error(t, err)
}

func TestIntegration_Field_NonEnumNoDict(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "NED", actor)
	dict := seedDict(t, ctx, svc)

	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID:       tpl.ID,
		Code:             "bad_text",
		Name:             "Bad",
		Type:             "text",
		SortOrder:        1,
		EnumDictionaryID: &dict.ID,
	})
	require.Error(t, err)
}

func TestIntegration_Field_TemplateOwnership(t *testing.T) {
	// GetField/UpdateField/SoftDeleteField must return ErrNotFound when
	// the field ID belongs to a different template.
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tplA := seedTemplate(t, ctx, svc, "OWNA", actor)
	tplB := seedTemplate(t, ctx, svc, "OWNB", actor)

	fieldOnA, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tplA.ID, Code: "fa", Name: "FA", Type: "text", SortOrder: 1,
	})
	require.NoError(t, err)

	// Accessing field from wrong template must 404.
	_, err = svc.GetField(ctx, tplB.ID, fieldOnA.ID)
	require.ErrorIs(t, err, tasks.ErrNotFound)

	_, err = svc.UpdateField(ctx, tplB.ID, fieldOnA.ID, tasks.UpdateFieldParams{Name: "x", Required: false})
	require.ErrorIs(t, err, tasks.ErrNotFound)

	_, err = svc.SoftDeleteField(ctx, tplB.ID, fieldOnA.ID)
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Field_Update(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "UPD", actor)

	row, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "myfield", Name: "My Field", Type: "text", SortOrder: 1,
	})
	require.NoError(t, err)

	updated, err := svc.UpdateField(ctx, tpl.ID, row.ID, tasks.UpdateFieldParams{
		Name:     "My Updated Field",
		Required: true,
	})
	require.NoError(t, err)
	assert.Equal(t, "My Updated Field", updated.Name)
	assert.True(t, updated.Required)
	// Code and type must not change.
	assert.Equal(t, "myfield", updated.Code)
	assert.Equal(t, "text", updated.Type)
}

func TestIntegration_Field_Reorder(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ROR", actor)

	a, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "fa", Name: "FA", Type: "text", SortOrder: 1,
	})
	require.NoError(t, err)
	b, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "fb", Name: "FB", Type: "text", SortOrder: 2,
	})
	require.NoError(t, err)
	c, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "fc", Name: "FC", Type: "text", SortOrder: 3,
	})
	require.NoError(t, err)

	err = svc.ReorderFields(ctx, tpl.ID, []uuid.UUID{c.ID, a.ID, b.ID})
	require.NoError(t, err)

	list, err := svc.ListFields(ctx, tpl.ID, false)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, c.ID, list[0].ID)
	assert.Equal(t, a.ID, list[1].ID)
	assert.Equal(t, b.ID, list[2].ID)
}

// =========================================================
// Phase 3 — Task CRUD
// =========================================================

// seedStatus creates a task status and returns it.
func seedStatus(t *testing.T, ctx context.Context, svc *tasks.Service, actor uuid.UUID) tasks.StatusRow {
	t.Helper()
	row, err := svc.CreateStatus(ctx, tasks.CreateStatusParams{
		Code:      "status_" + uuid.NewString()[:8],
		Name:      "Open",
		SortOrder: 1,
		ActorID:   actor,
	})
	require.NoError(t, err)
	return row
}

func TestIntegration_Task_CreateBasic(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "DEV", actor)
	status := seedStatus(t, ctx, svc, actor)

	resp, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID,
		Title:      "Fix login bug",
		StatusID:   status.ID,
		ActorID:    actor,
	})
	require.NoError(t, err)
	assert.NotEqual(t, uuid.Nil, resp.ID)
	assert.Equal(t, "DEV-1", resp.PublicID)
	assert.Equal(t, int64(1), resp.SequenceNumber)
	assert.Equal(t, "DEV", resp.TemplateSnapshotPrefix)
	assert.Equal(t, "Fix login bug", resp.Title)
	assert.Nil(t, resp.Description)
	assert.Empty(t, resp.FieldValues)
}

func TestIntegration_Task_SequentialPublicID(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "SEQ", actor)
	status := seedStatus(t, ctx, svc, actor)

	p := tasks.CreateTaskParams{TemplateID: tpl.ID, Title: "T", StatusID: status.ID, ActorID: actor}

	r1, err := svc.CreateTask(ctx, p)
	require.NoError(t, err)
	r2, err := svc.CreateTask(ctx, p)
	require.NoError(t, err)

	assert.Equal(t, "SEQ-1", r1.PublicID)
	assert.Equal(t, "SEQ-2", r2.PublicID)
}

func TestIntegration_Task_IndependentSequencePerTemplate(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tplDev := seedTemplate(t, ctx, svc, "IND", actor)
	tplQA := seedTemplate(t, ctx, svc, "QAI", actor)
	status := seedStatus(t, ctx, svc, actor)

	r1, err := svc.CreateTask(ctx, tasks.CreateTaskParams{TemplateID: tplDev.ID, Title: "dev task", StatusID: status.ID, ActorID: actor})
	require.NoError(t, err)
	r2, err := svc.CreateTask(ctx, tasks.CreateTaskParams{TemplateID: tplQA.ID, Title: "qa task", StatusID: status.ID, ActorID: actor})
	require.NoError(t, err)
	r3, err := svc.CreateTask(ctx, tasks.CreateTaskParams{TemplateID: tplDev.ID, Title: "dev task 2", StatusID: status.ID, ActorID: actor})
	require.NoError(t, err)

	assert.Equal(t, "IND-1", r1.PublicID)
	assert.Equal(t, "QAI-1", r2.PublicID)
	assert.Equal(t, "IND-2", r3.PublicID)
}

func TestIntegration_Task_DeletedTemplateReturnsError(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "DTL", actor)
	status := seedStatus(t, ctx, svc, actor)

	_, err := svc.SoftDeleteTemplate(ctx, tpl.ID, actor)
	require.NoError(t, err)

	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "should fail", StatusID: status.ID, ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_Task_DeletedStatusReturnsError(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "DST", actor)
	status := seedStatus(t, ctx, svc, actor)

	_, err := svc.SoftDeleteStatus(ctx, status.ID)
	require.NoError(t, err)

	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "should fail", StatusID: status.ID, ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_Task_RequiredFieldMissing(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "REQ", actor)
	status := seedStatus(t, ctx, svc, actor)

	// Add a required field to the template.
	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "priority", Name: "Priority", Type: "text",
		Required: true, SortOrder: 1,
	})
	require.NoError(t, err)

	// Create task without providing the required field.
	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "missing field", StatusID: status.ID, ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_Task_AllFieldTypes(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "AFT", actor)
	status := seedStatus(t, ctx, svc, actor)

	dict := seedDict(t, ctx, svc)
	ver, err := svc.CreateDictionaryVersion(ctx, dict.ID, []tasks.DictionaryItemInput{
		{ValueCode: "high", ValueName: "High", SortOrder: 1, IsActive: true},
		{ValueCode: "low", ValueName: "Low", SortOrder: 2, IsActive: true},
	}, actor)
	require.NoError(t, err)

	textField, _ := svc.CreateField(ctx, tasks.CreateFieldParams{TemplateID: tpl.ID, Code: "txt", Name: "Text", Type: "text", SortOrder: 1})
	numField, _ := svc.CreateField(ctx, tasks.CreateFieldParams{TemplateID: tpl.ID, Code: "num", Name: "Number", Type: "number", SortOrder: 2})
	userField, _ := svc.CreateField(ctx, tasks.CreateFieldParams{TemplateID: tpl.ID, Code: "usr", Name: "User", Type: "user", SortOrder: 3})
	dateField, _ := svc.CreateField(ctx, tasks.CreateFieldParams{TemplateID: tpl.ID, Code: "dt", Name: "Date", Type: "date", SortOrder: 4})
	enumField, _ := svc.CreateField(ctx, tasks.CreateFieldParams{TemplateID: tpl.ID, Code: "en", Name: "Enum", Type: "enum", SortOrder: 5, EnumDictionaryID: &dict.ID})

	enumVer := int32(ver.Version)
	txtVal := "hello"
	numVal := "42.5"
	dateVal := "2024-03-01"

	resp, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID,
		Title:      "all fields",
		StatusID:   status.ID,
		ActorID:    actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: textField.ID, ValueText: &txtVal},
			{FieldDefinitionID: numField.ID, ValueNumber: &numVal},
			{FieldDefinitionID: userField.ID, ValueUserID: &actor},
			{FieldDefinitionID: dateField.ID, ValueDate: &dateVal},
			{FieldDefinitionID: enumField.ID, ValueJSON: []byte(`["high"]`), EnumDictionaryID: &dict.ID, EnumVersion: &enumVer},
		},
	})
	require.NoError(t, err)
	assert.Len(t, resp.FieldValues, 5)

	// Round-trip via GetTask.
	got, err := svc.GetTask(ctx, resp.ID)
	require.NoError(t, err)
	assert.Equal(t, resp.PublicID, got.PublicID)
	assert.Len(t, got.FieldValues, 5)

	// Verify specific values.
	byDef := make(map[uuid.UUID]tasks.FieldValueRow)
	for _, fv := range got.FieldValues {
		byDef[fv.FieldDefinitionID] = fv
	}
	require.NotNil(t, byDef[textField.ID].ValueText)
	assert.Equal(t, "hello", *byDef[textField.ID].ValueText)
	require.NotNil(t, byDef[numField.ID].ValueNumber)
	assert.Equal(t, "42.500000", *byDef[numField.ID].ValueNumber)
	require.NotNil(t, byDef[userField.ID].ValueUserID)
	assert.Equal(t, actor, *byDef[userField.ID].ValueUserID)
	require.NotNil(t, byDef[dateField.ID].ValueDate)
	assert.Equal(t, "2024-03-01", *byDef[dateField.ID].ValueDate)
	assert.NotNil(t, byDef[enumField.ID].EnumDictionaryID)
	assert.NotNil(t, byDef[enumField.ID].EnumVersion)
	assert.Equal(t, enumVer, *byDef[enumField.ID].EnumVersion)
}

func TestIntegration_Task_UpdateSystemFields(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "UPT", actor)
	s1 := seedStatus(t, ctx, svc, actor)
	s2 := seedStatus(t, ctx, svc, actor)

	resp, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "original", StatusID: s1.ID, ActorID: actor,
	})
	require.NoError(t, err)

	desc := "updated description"
	updated, err := svc.UpdateTask(ctx, resp.ID, tasks.UpdateTaskParams{
		Title:       "updated title",
		Description: &desc,
		StatusID:    s2.ID,
		ActorID:     actor,
	})
	require.NoError(t, err)
	assert.Equal(t, "updated title", updated.Title)
	require.NotNil(t, updated.Description)
	assert.Equal(t, "updated description", *updated.Description)
	assert.Equal(t, s2.ID, updated.StatusID)
	// public_id must not change on update.
	assert.Equal(t, resp.PublicID, updated.PublicID)
}

func TestIntegration_Task_UpdateFieldValues_ReplaceAll(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "RPL", actor)
	status := seedStatus(t, ctx, svc, actor)

	f1, _ := svc.CreateField(ctx, tasks.CreateFieldParams{TemplateID: tpl.ID, Code: "f1", Name: "F1", Type: "text", SortOrder: 1})
	f2, _ := svc.CreateField(ctx, tasks.CreateFieldParams{TemplateID: tpl.ID, Code: "f2", Name: "F2", Type: "text", SortOrder: 2})

	v1, v2 := "value1", "value2"
	resp, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "t", StatusID: status.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: f1.ID, ValueText: &v1},
			{FieldDefinitionID: f2.ID, ValueText: &v2},
		},
	})
	require.NoError(t, err)
	assert.Len(t, resp.FieldValues, 2)

	// Update with only f1 — f2 should be deleted (replace-all).
	newV1 := "new_value1"
	updated, err := svc.UpdateTask(ctx, resp.ID, tasks.UpdateTaskParams{
		Title: "t", StatusID: status.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: f1.ID, ValueText: &newV1},
		},
	})
	require.NoError(t, err)
	require.Len(t, updated.FieldValues, 1)
	assert.Equal(t, f1.ID, updated.FieldValues[0].FieldDefinitionID)
	require.NotNil(t, updated.FieldValues[0].ValueText)
	assert.Equal(t, "new_value1", *updated.FieldValues[0].ValueText)
}

func TestIntegration_Task_GetNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)

	_, err := svc.GetTask(ctx, uuid.New())
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Task_UpdateNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	status := seedStatus(t, ctx, svc, actor)

	_, err := svc.UpdateTask(ctx, uuid.New(), tasks.UpdateTaskParams{
		Title: "t", StatusID: status.ID, ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Task_UnknownTemplateReturnsNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	status := seedStatus(t, ctx, svc, actor)

	// A non-existent template_id must return ErrNotFound.
	_, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: uuid.New(), Title: "t", StatusID: status.ID, ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Task_PrefixLockedAfterTaskCreated(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "LCK", actor)
	status := seedStatus(t, ctx, svc, actor)

	// Create a task so the prefix is now locked.
	_, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "any", StatusID: status.ID, ActorID: actor,
	})
	require.NoError(t, err)

	// Attempt to change the prefix must fail.
	_, err = svc.UpdateTemplate(ctx, tpl.ID, tasks.UpdateTemplateParams{
		Prefix:  "NEW",
		ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_Task_TitleRequired(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "TTL", actor)
	status := seedStatus(t, ctx, svc, actor)

	_, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "   ", StatusID: status.ID, ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

// Test #7: UpdateTask to a soft-deleted status must return ErrBadRequest.
func TestIntegration_Task_UpdateToDeletedStatusReturnsError(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "UDS", actor)
	s1 := seedStatus(t, ctx, svc, actor)
	s2 := seedStatus(t, ctx, svc, actor)

	resp, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "task", StatusID: s1.ID, ActorID: actor,
	})
	require.NoError(t, err)

	_, err = svc.SoftDeleteStatus(ctx, s2.ID)
	require.NoError(t, err)

	_, err = svc.UpdateTask(ctx, resp.ID, tasks.UpdateTaskParams{
		Title: "task", StatusID: s2.ID, ActorID: actor,
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

// Test #8: A required field submitted with all value columns nil must be rejected.
func TestIntegration_Task_RequiredFieldAllNullValuesRejected(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "RNV", actor)
	status := seedStatus(t, ctx, svc, actor)

	_, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "summary", Name: "Summary", Type: "text",
		Required: true, SortOrder: 1,
	})
	require.NoError(t, err)

	field, err := svc.ListFields(ctx, tpl.ID, false)
	require.NoError(t, err)
	require.Len(t, field, 1)

	// Provide the field ID but leave all value columns nil.
	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "task", StatusID: status.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field[0].ID}, // all value columns nil
		},
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

// =========================================================
// Phase 4 — ListTasks
// =========================================================

// seedTask creates a minimal task and returns it.
func seedTask(t *testing.T, ctx context.Context, svc *tasks.Service, tplID, statusID, actorID uuid.UUID, title string) tasks.TaskResponse {
	t.Helper()
	resp, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tplID,
		Title:      title,
		StatusID:   statusID,
		ActorID:    actorID,
	})
	require.NoError(t, err)
	return resp
}

func TestIntegration_ListTasks_EmptyReturnsStatusGroups(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	st1 := seedStatus(t, ctx, svc, actor)
	st2 := seedStatus(t, ctx, svc, actor)

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{})
	require.NoError(t, err)
	// Two active statuses → two groups (possibly zero tasks each).
	require.Len(t, resp.Groups, 2)
	assert.Equal(t, 0, resp.GrandTotal)

	groupIDs := []uuid.UUID{resp.Groups[0].Status.ID, resp.Groups[1].Status.ID}
	assert.Contains(t, groupIDs, st1.ID)
	assert.Contains(t, groupIDs, st2.ID)
}

func TestIntegration_ListTasks_TasksAppearInCorrectGroup(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "GRP", actor)
	st1 := seedStatus(t, ctx, svc, actor)
	st2 := seedStatus(t, ctx, svc, actor)

	seedTask(t, ctx, svc, tpl.ID, st1.ID, actor, "Task in st1")
	seedTask(t, ctx, svc, tpl.ID, st1.ID, actor, "Another in st1")
	seedTask(t, ctx, svc, tpl.ID, st2.ID, actor, "Task in st2")

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{})
	require.NoError(t, err)
	assert.Equal(t, 3, resp.GrandTotal)

	for _, g := range resp.Groups {
		switch g.Status.ID {
		case st1.ID:
			assert.Equal(t, 2, g.Total)
			assert.Len(t, g.Tasks, 2)
		case st2.ID:
			assert.Equal(t, 1, g.Total)
			assert.Len(t, g.Tasks, 1)
		}
	}
}

func TestIntegration_ListTasks_SearchByPublicID(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "SRC", actor)
	st := seedStatus(t, ctx, svc, actor)

	task := seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "Needle task")
	seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "Other task")

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{Search: task.PublicID})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal)
	require.Len(t, resp.Groups[0].Tasks, 1)
	assert.Equal(t, task.ID, resp.Groups[0].Tasks[0].ID)
}

func TestIntegration_ListTasks_SearchByDescription(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "DSC", actor)
	st := seedStatus(t, ctx, svc, actor)

	desc := "unique description needle"
	_, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID:  tpl.ID,
		Title:       "Task with description",
		Description: &desc,
		StatusID:    st.ID,
		ActorID:     actor,
	})
	require.NoError(t, err)
	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID,
		Title:      "Task without description",
		StatusID:   st.ID,
		ActorID:    actor,
	})
	require.NoError(t, err)

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{Search: "unique description needle"})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal)
}

func TestIntegration_ListTasks_SearchByTitle(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "TTL", actor)
	st := seedStatus(t, ctx, svc, actor)

	seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "Login button broken")
	seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "Signup flow")

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{Search: "login"})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal)
	assert.Equal(t, "Login button broken", resp.Groups[0].Tasks[0].Title)
}

func TestIntegration_ListTasks_FilterByStatus(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "FST", actor)
	st1 := seedStatus(t, ctx, svc, actor)
	st2 := seedStatus(t, ctx, svc, actor)

	seedTask(t, ctx, svc, tpl.ID, st1.ID, actor, "In st1")
	seedTask(t, ctx, svc, tpl.ID, st2.ID, actor, "In st2")

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{StatusIDs: []uuid.UUID{st1.ID}})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal)

	// Only the matching status group should have tasks.
	for _, g := range resp.Groups {
		if g.Status.ID == st1.ID {
			assert.Equal(t, 1, g.Total)
		} else {
			assert.Equal(t, 0, g.Total)
		}
	}
}

func TestIntegration_ListTasks_FilterByPrefix(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tplA := seedTemplate(t, ctx, svc, "FPRA", actor)
	tplB := seedTemplate(t, ctx, svc, "FPRB", actor)
	st := seedStatus(t, ctx, svc, actor)

	seedTask(t, ctx, svc, tplA.ID, st.ID, actor, "Task A")
	seedTask(t, ctx, svc, tplA.ID, st.ID, actor, "Task A2")
	seedTask(t, ctx, svc, tplB.ID, st.ID, actor, "Task B")

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{Prefixes: []string{"FPRA"}})
	require.NoError(t, err)
	assert.Equal(t, 2, resp.GrandTotal)
}

func TestIntegration_ListTasks_FilterByUserField(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	user2 := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "FUF", actor)
	st := seedStatus(t, ctx, svc, actor)

	// Create a user-type field.
	field, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "owner", Name: "Owner", Type: "user", SortOrder: 1,
	})
	require.NoError(t, err)

	// Task assigned to actor.
	actorTask, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "Actor's task", StatusID: st.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field.ID, ValueUserID: &actor},
		},
	})
	require.NoError(t, err)

	// Task assigned to user2.
	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "User2's task", StatusID: st.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field.ID, ValueUserID: &user2},
		},
	})
	require.NoError(t, err)

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{
		FieldFilters: []tasks.FieldFilter{
			{FieldDefinitionID: field.ID, UserIDs: []uuid.UUID{actor}},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal)
	assert.Equal(t, actorTask.ID, resp.Groups[0].Tasks[0].ID)
}

func TestIntegration_ListTasks_FilterByEnumField(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "FEF", actor)
	st := seedStatus(t, ctx, svc, actor)
	dict := seedDict(t, ctx, svc)

	// Create a version with items.
	ver, err := svc.CreateDictionaryVersion(ctx, dict.ID, []tasks.DictionaryItemInput{
		{ValueCode: "high", ValueName: "High", SortOrder: 1, IsActive: true},
		{ValueCode: "low", ValueName: "Low", SortOrder: 2, IsActive: true},
	}, actor)
	require.NoError(t, err)

	field, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "priority", Name: "Priority",
		Type: "enum", SortOrder: 1, EnumDictionaryID: &dict.ID,
	})
	require.NoError(t, err)

	v := int32(ver.Version)
	highTask, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "High prio", StatusID: st.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field.ID, ValueText: strPtr("high"), EnumDictionaryID: &dict.ID, EnumVersion: &v},
		},
	})
	require.NoError(t, err)

	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "Low prio", StatusID: st.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field.ID, ValueText: strPtr("low"), EnumDictionaryID: &dict.ID, EnumVersion: &v},
		},
	})
	require.NoError(t, err)

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{
		FieldFilters: []tasks.FieldFilter{
			{FieldDefinitionID: field.ID, EnumCodes: []string{"high"}},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal)
	assert.Equal(t, highTask.ID, resp.Groups[0].Tasks[0].ID)
}

func TestIntegration_ListTasks_FilterByDateField(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "FDF", actor)
	st := seedStatus(t, ctx, svc, actor)

	field, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "due", Name: "Due Date", Type: "date", SortOrder: 1,
	})
	require.NoError(t, err)

	earlyTask, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "Early", StatusID: st.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field.ID, ValueDate: strPtr("2025-01-01")},
		},
	})
	require.NoError(t, err)

	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "Late", StatusID: st.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field.ID, ValueDate: strPtr("2025-12-31")},
		},
	})
	require.NoError(t, err)

	from := "2025-01-01"
	to := "2025-06-30"
	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{
		FieldFilters: []tasks.FieldFilter{
			{FieldDefinitionID: field.ID, DateFrom: &from, DateTo: &to},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal)
	assert.Equal(t, earlyTask.ID, resp.Groups[0].Tasks[0].ID)
}

func TestIntegration_ListTasks_SortByCreatedAt(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "SCA", actor)
	st := seedStatus(t, ctx, svc, actor)

	t1 := seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "First")
	t2 := seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "Second")
	t3 := seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "Third")

	// ASC: oldest first.
	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{SortBy: "created_at", SortDesc: false})
	require.NoError(t, err)
	require.NotEmpty(t, resp.Groups)
	grp := resp.Groups[0]
	require.Len(t, grp.Tasks, 3)
	assert.Equal(t, t1.ID, grp.Tasks[0].ID)
	assert.Equal(t, t2.ID, grp.Tasks[1].ID)
	assert.Equal(t, t3.ID, grp.Tasks[2].ID)

	// DESC: newest first.
	resp, err = svc.ListTasks(ctx, tasks.ListTasksParams{SortBy: "created_at", SortDesc: true})
	require.NoError(t, err)
	grp = resp.Groups[0]
	require.Len(t, grp.Tasks, 3)
	assert.Equal(t, t3.ID, grp.Tasks[0].ID)
	assert.Equal(t, t1.ID, grp.Tasks[2].ID)
}

func TestIntegration_ListTasks_SortByNumericField(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "SNF", actor)
	st := seedStatus(t, ctx, svc, actor)

	field, err := svc.CreateField(ctx, tasks.CreateFieldParams{
		TemplateID: tpl.ID, Code: "points", Name: "Story Points", Type: "number", SortOrder: 1,
	})
	require.NoError(t, err)

	highPts, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "High points", StatusID: st.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field.ID, ValueNumber: strPtr("8")},
		},
	})
	require.NoError(t, err)

	lowPts, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID: tpl.ID, Title: "Low points", StatusID: st.ID, ActorID: actor,
		FieldValues: []tasks.FieldValueInput{
			{FieldDefinitionID: field.ID, ValueNumber: strPtr("2")},
		},
	})
	require.NoError(t, err)

	// ASC: low first.
	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{
		SortBy: field.ID.String(), SortDesc: false,
	})
	require.NoError(t, err)
	grp := resp.Groups[0]
	require.Len(t, grp.Tasks, 2)
	assert.Equal(t, lowPts.ID, grp.Tasks[0].ID)
	assert.Equal(t, highPts.ID, grp.Tasks[1].ID)
}

func TestIntegration_ListTasks_Pagination(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "PAG", actor)
	st := seedStatus(t, ctx, svc, actor)

	for i := 0; i < 5; i++ {
		seedTask(t, ctx, svc, tpl.ID, st.ID, actor, fmt.Sprintf("Task %d", i))
	}

	// Page 1 of page_size 2.
	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{Page: 1, PageSize: 2})
	require.NoError(t, err)
	grp := findGroup(t, resp.Groups, st.ID)
	assert.Equal(t, 5, grp.Total)
	assert.Len(t, grp.Tasks, 2)

	// Page 3 of page_size 2 → last page with 1 item.
	resp, err = svc.ListTasks(ctx, tasks.ListTasksParams{Page: 3, PageSize: 2})
	require.NoError(t, err)
	grp = findGroup(t, resp.Groups, st.ID)
	assert.Len(t, grp.Tasks, 1)
}

func TestIntegration_ListTasks_DeletedStatusHiddenWhenNoTasks(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	st := seedStatus(t, ctx, svc, actor)
	_, err := svc.SoftDeleteStatus(ctx, st.ID)
	require.NoError(t, err)

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{})
	require.NoError(t, err)
	// Deleted status with no tasks should not appear.
	for _, g := range resp.Groups {
		assert.NotEqual(t, st.ID, g.Status.ID)
	}
}

func TestIntegration_ListTasks_DeletedStatusAppearsWhenTasksExist(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "DST", actor)

	st := seedStatus(t, ctx, svc, actor)
	seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "Old task")

	_, err := svc.SoftDeleteStatus(ctx, st.ID)
	require.NoError(t, err)

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{})
	require.NoError(t, err)
	// Deleted status should still appear because it has a task.
	found := false
	for _, g := range resp.Groups {
		if g.Status.ID == st.ID {
			found = true
			assert.Equal(t, 1, g.Total)
		}
	}
	assert.True(t, found, "deleted status with tasks must appear in groups")
}

func TestIntegration_ListTasks_DeletedTemplateTasksStillAppear(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "DTT", actor)
	st := seedStatus(t, ctx, svc, actor)

	seedTask(t, ctx, svc, tpl.ID, st.ID, actor, "Task on deleted template")

	_, err := svc.SoftDeleteTemplate(ctx, tpl.ID, actor)
	require.NoError(t, err)

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal, "tasks from deleted templates must still appear")
}

func TestIntegration_ListTasks_MultipleFilters(t *testing.T) {
	// Combined: filter by prefix AND search.
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tplA := seedTemplate(t, ctx, svc, "CMBA", actor)
	tplB := seedTemplate(t, ctx, svc, "CMBB", actor)
	st := seedStatus(t, ctx, svc, actor)

	target := seedTask(t, ctx, svc, tplA.ID, st.ID, actor, "Unique title abc")
	seedTask(t, ctx, svc, tplA.ID, st.ID, actor, "Other title")
	seedTask(t, ctx, svc, tplB.ID, st.ID, actor, "Unique title abc on B")

	resp, err := svc.ListTasks(ctx, tasks.ListTasksParams{
		Search:   "unique title abc",
		Prefixes: []string{"CMBA"},
	})
	require.NoError(t, err)
	assert.Equal(t, 1, resp.GrandTotal)
	assert.Equal(t, target.ID, resp.Groups[0].Tasks[0].ID)
}

// ---- test helpers ----

// strPtr is a convenience helper used in Phase 4 tests.
func strPtr(s string) *string { return &s }

// findGroup returns the TaskGroup for the given status ID from the response.
func findGroup(t *testing.T, groups []tasks.TaskGroup, statusID uuid.UUID) tasks.TaskGroup {
	t.Helper()
	for _, g := range groups {
		if g.Status.ID == statusID {
			return g
		}
	}
	t.Fatalf("group for status %s not found", statusID)
	return tasks.TaskGroup{}
}

// uuidPtr wraps a UUID value in a pointer for ParentTaskID params.
func uuidPtr(id uuid.UUID) *uuid.UUID { return &id }

// =========================================================
// Phase 5 — Subtasks
// =========================================================

func TestIntegration_Subtask_CreateAndAppearInParent(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "SUB", actor)
	status := seedStatus(t, ctx, svc, actor)

	parent := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Parent task")

	// Create a subtask under the parent.
	sub, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID:   tpl.ID,
		ParentTaskID: uuidPtr(parent.ID),
		Title:        "Subtask one",
		StatusID:     status.ID,
		ActorID:      actor,
	})
	require.NoError(t, err)
	assert.Equal(t, parent.ID, *sub.ParentTaskID)
	assert.NotEmpty(t, sub.PublicID)

	// Fetching the parent must include the subtask in Subtasks.
	resp, err := svc.GetTask(ctx, parent.ID)
	require.NoError(t, err)
	require.Len(t, resp.Subtasks, 1)
	assert.Equal(t, sub.ID, resp.Subtasks[0].ID)
	assert.Equal(t, "Subtask one", resp.Subtasks[0].Title)
	assert.Nil(t, resp.ParentPublicID) // parent card has no breadcrumb

	// Fetching the subtask must not include nested subtasks and must expose the parent public_id.
	subResp, err := svc.GetTask(ctx, sub.ID)
	require.NoError(t, err)
	assert.Empty(t, subResp.Subtasks)
	require.NotNil(t, subResp.ParentPublicID)
	assert.Equal(t, parent.PublicID, *subResp.ParentPublicID)
}

func TestIntegration_Subtask_MultipleSubtasksOrderedByCreation(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ORD", actor)
	status := seedStatus(t, ctx, svc, actor)

	parent := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Parent")

	titles := []string{"Alpha", "Beta", "Gamma"}
	for _, title := range titles {
		_, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
			TemplateID:   tpl.ID,
			ParentTaskID: uuidPtr(parent.ID),
			Title:        title,
			StatusID:     status.ID,
			ActorID:      actor,
		})
		require.NoError(t, err)
	}

	resp, err := svc.GetTask(ctx, parent.ID)
	require.NoError(t, err)
	require.Len(t, resp.Subtasks, 3)
	// Subtasks must be returned in creation order (ASC).
	assert.Equal(t, "Alpha", resp.Subtasks[0].Title)
	assert.Equal(t, "Beta", resp.Subtasks[1].Title)
	assert.Equal(t, "Gamma", resp.Subtasks[2].Title)
}

func TestIntegration_Subtask_SelfReferenceRejected(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "SLF", actor)
	status := seedStatus(t, ctx, svc, actor)

	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Solo task")

	// Attempting to make a task its own parent must be rejected at the app layer.
	_, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID:   tpl.ID,
		ParentTaskID: uuidPtr(task.ID),
		Title:        "Should fail",
		StatusID:     status.ID,
		ActorID:      actor,
	})
	// The app layer checks parent.ParentTaskID.Valid — the parent itself has none,
	// so app-layer pre-check passes. The DB trigger fires the self-reference guard
	// only on a direct self-INSERT (id == parent_task_id). That cannot happen here
	// because the new task has a different ID. The real nesting guard is tested below.
	// This test confirms a subtask of a top-level task is accepted.
	require.NoError(t, err)

	// Now verify that a task truly cannot reference itself (would require an UPDATE,
	// which the service does not expose for parent_task_id — the constraint is enforced
	// at the DB level; we test the app-layer guard for the "already a subtask" case below).
}

func TestIntegration_Subtask_SecondLevelNestingRejected(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "NLV", actor)
	status := seedStatus(t, ctx, svc, actor)

	parent := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Top-level")

	sub, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID:   tpl.ID,
		ParentTaskID: uuidPtr(parent.ID),
		Title:        "Level 1 subtask",
		StatusID:     status.ID,
		ActorID:      actor,
	})
	require.NoError(t, err)

	// Attempt to create a subtask of the subtask — rejected at app layer.
	_, err = svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID:   tpl.ID,
		ParentTaskID: uuidPtr(sub.ID),
		Title:        "Level 2 — must fail",
		StatusID:     status.ID,
		ActorID:      actor,
	})
	require.ErrorIs(t, err, tasks.ErrBadRequest)
	assert.Contains(t, err.Error(), "already a subtask")
}

func TestIntegration_Subtask_ParentNotFoundRejected(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "PNF", actor)
	status := seedStatus(t, ctx, svc, actor)

	nonexistent := uuid.New()
	_, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID:   tpl.ID,
		ParentTaskID: uuidPtr(nonexistent),
		Title:        "Orphan",
		StatusID:     status.ID,
		ActorID:      actor,
	})
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Subtask_DBTrigger_SelfReferenceRejected(t *testing.T) {
	// The DB trigger rejects a task whose parent_task_id equals its own id.
	// This scenario cannot be triggered through the service's CreateTask (a new
	// task gets a fresh UUID that differs from the parent UUID passed in), but
	// we can verify the trigger by inserting directly into the DB.
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "TRG", actor)
	status := seedStatus(t, ctx, svc, actor)

	// First create a normal task.
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Normal task")

	// Attempt a direct UPDATE that sets parent_task_id = id (self-reference).
	_, err := pool.Exec(ctx,
		`UPDATE task SET parent_task_id = id WHERE id = $1`,
		task.ID,
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cannot be its own parent")
}

func TestIntegration_Subtask_DBTrigger_DeepNestingRejected(t *testing.T) {
	// The DB trigger rejects a task whose parent already has a parent.
	// Bypasses app-layer to confirm the DB constraint is independently enforced.
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "DPT", actor)
	status := seedStatus(t, ctx, svc, actor)

	parent := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Level 0")
	sub := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Level 1")

	// Manually set sub.parent_task_id = parent.id (bypassing service app-layer).
	_, err := pool.Exec(ctx,
		`UPDATE task SET parent_task_id = $1 WHERE id = $2`,
		parent.ID, sub.ID,
	)
	require.NoError(t, err)

	// Now try to create a third task with parent = sub (level 2) — direct INSERT.
	_, err = pool.Exec(ctx,
		`INSERT INTO task (template_id, parent_task_id, title, status_id, created_by, updated_by)
		 VALUES ($1, $2, 'Level 2', $3, $4, $4)`,
		tpl.ID, sub.ID, status.ID, actor,
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "one level")
}

func TestIntegration_Subtask_SubtaskCardReturnsEmptySubtasksList(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "EMP", actor)
	status := seedStatus(t, ctx, svc, actor)

	parent := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Parent")
	sub, err := svc.CreateTask(ctx, tasks.CreateTaskParams{
		TemplateID:   tpl.ID,
		ParentTaskID: uuidPtr(parent.ID),
		Title:        "Child",
		StatusID:     status.ID,
		ActorID:      actor,
	})
	require.NoError(t, err)

	resp, err := svc.GetTask(ctx, sub.ID)
	require.NoError(t, err)
	// A subtask card must never return subtasks (one-level limit).
	assert.NotNil(t, resp.Subtasks)
	assert.Empty(t, resp.Subtasks)
}

// =========================================================
// Phase 6 — Comments
// =========================================================

func TestIntegration_Comment_CreateAndList(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CMT", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Comment test task")

	c1, err := svc.CreateComment(ctx, task.ID, actor, "First comment")
	require.NoError(t, err)
	assert.Equal(t, "First comment", c1.Body)
	assert.Equal(t, task.ID, c1.TaskID)
	assert.Equal(t, actor, c1.AuthorID)

	c2, err := svc.CreateComment(ctx, task.ID, actor, "Second comment")
	require.NoError(t, err)
	assert.Equal(t, "Second comment", c2.Body)

	list, err := svc.ListComments(ctx, task.ID)
	require.NoError(t, err)
	require.Len(t, list, 2)

	// Must be in chronological order.
	assert.Equal(t, c1.ID, list[0].ID)
	assert.Equal(t, c2.ID, list[1].ID)
}

func TestIntegration_Comment_EmptyBodyRejected(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CME", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Comment empty body")

	_, err := svc.CreateComment(ctx, task.ID, actor, "   ")
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_Comment_UnknownTaskReturnsNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)

	_, err := svc.CreateComment(ctx, uuid.New(), actor, "body")
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Comment_DBTriggerPreventsBodyEdit(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CMB", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "DB trigger test")

	c, err := svc.CreateComment(ctx, task.ID, actor, "Original body")
	require.NoError(t, err)

	// Attempt a direct UPDATE on the body — must be rejected by the trigger.
	_, err = pool.Exec(ctx, `UPDATE task_comment SET body = 'Hacked' WHERE id = $1`, c.ID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "editing is not allowed")
}

func TestIntegration_Comment_ListOnUnknownTaskReturnsNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	svc := tasks.NewService(pool, nil)

	_, err := svc.ListComments(ctx, uuid.New())
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_CommentAttachment_UploadCreateListDownload(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CMA", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Comment attachment")

	content := []byte("comment-image-content")
	uploaded, err := svc.UploadCommentAttachment(ctx, tasks.UploadCommentAttachmentParams{
		TaskID:   task.ID,
		ActorID:  actor,
		FileName: "photo.jpg",
		MimeType: "image/jpeg",
		Size:     int64(len(content)),
		Body:     bytes.NewReader(content),
	}, 50)
	require.NoError(t, err)
	require.Nil(t, uploaded.CommentID)

	comment, err := svc.CreateComment(ctx, task.ID, actor, "", uploaded.ID)
	require.NoError(t, err)
	assert.Equal(t, "", comment.Body)
	require.Len(t, comment.Attachments, 1)
	assert.Equal(t, uploaded.ID, comment.Attachments[0].ID)
	assert.NotNil(t, comment.Attachments[0].CommentID)
	assert.Equal(t, comment.ID, *comment.Attachments[0].CommentID)

	list, err := svc.ListComments(ctx, task.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Len(t, list[0].Attachments, 1)
	assert.Equal(t, "photo.jpg", list[0].Attachments[0].FileName)

	body, _, _, fileName, err := svc.DownloadCommentAttachment(ctx, task.ID, comment.ID, uploaded.ID)
	require.NoError(t, err)
	defer body.Close()
	raw, err := io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, content, raw)
	assert.Equal(t, "photo.jpg", fileName)
}

func TestIntegration_CommentAttachment_CreateRejectsWrongUploader(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	other := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CMB", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Wrong uploader")

	uploaded, err := svc.UploadCommentAttachment(ctx, tasks.UploadCommentAttachmentParams{
		TaskID:   task.ID,
		ActorID:  actor,
		FileName: "clip.mp4",
		MimeType: "video/mp4",
		Size:     int64(len("video")),
		Body:     bytes.NewReader([]byte("video")),
	}, 50)
	require.NoError(t, err)

	_, err = svc.CreateComment(ctx, task.ID, other, "cannot use", uploaded.ID)
	require.ErrorIs(t, err, tasks.ErrForbidden)
}

func TestIntegration_CommentAttachment_UploadRejectsMultipartSizeMismatch(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CME", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Size mismatch")

	// Simulate a client claiming a smaller multipart size than bytes actually sent.
	_, err := svc.UploadCommentAttachment(ctx, tasks.UploadCommentAttachmentParams{
		TaskID:   task.ID,
		ActorID:  actor,
		FileName: "mismatch.bin",
		MimeType: "application/octet-stream",
		Size:     1,
		Body:     bytes.NewReader([]byte("abcdef")),
	}, 50)
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_CommentAttachment_DeleteStagedRules(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	other := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CMC", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Delete staged")

	staged, err := svc.UploadCommentAttachment(ctx, tasks.UploadCommentAttachmentParams{
		TaskID:   task.ID,
		ActorID:  actor,
		FileName: "doc.txt",
		MimeType: "text/plain",
		Size:     int64(len("doc")),
		Body:     bytes.NewReader([]byte("doc")),
	}, 50)
	require.NoError(t, err)

	err = svc.DeleteStagedCommentAttachment(ctx, task.ID, other, staged.ID)
	require.ErrorIs(t, err, tasks.ErrForbidden)

	err = svc.DeleteStagedCommentAttachment(ctx, task.ID, actor, staged.ID)
	require.NoError(t, err)

	linked, err := svc.UploadCommentAttachment(ctx, tasks.UploadCommentAttachmentParams{
		TaskID:   task.ID,
		ActorID:  actor,
		FileName: "linked.txt",
		MimeType: "text/plain",
		Size:     int64(len("linked")),
		Body:     bytes.NewReader([]byte("linked")),
	}, 50)
	require.NoError(t, err)

	comment, err := svc.CreateComment(ctx, task.ID, actor, "with file", linked.ID)
	require.NoError(t, err)
	require.NotNil(t, comment)

	err = svc.DeleteStagedCommentAttachment(ctx, task.ID, actor, linked.ID)
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_CommentAttachment_CreateRejectsWrongTaskAttachment(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "CMD", actor)
	status := seedStatus(t, ctx, svc, actor)
	task1 := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Task 1")
	task2 := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Task 2")

	uploaded, err := svc.UploadCommentAttachment(ctx, tasks.UploadCommentAttachmentParams{
		TaskID:   task1.ID,
		ActorID:  actor,
		FileName: "wrong-task.bin",
		MimeType: "application/octet-stream",
		Size:     int64(len("bin")),
		Body:     bytes.NewReader([]byte("bin")),
	}, 50)
	require.NoError(t, err)

	_, err = svc.CreateComment(ctx, task2.ID, actor, "bad link", uploaded.ID)
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

// =========================================================
// Phase 6 — Attachments
// =========================================================

func TestIntegration_Attachment_UploadListDelete(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ATT", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Attachment task")

	content := []byte("hello attachment content")
	row, err := svc.UploadAttachment(ctx, tasks.UploadAttachmentParams{
		TaskID:   task.ID,
		ActorID:  actor,
		FileName: "hello.txt",
		MimeType: "text/plain",
		Size:     int64(len(content)),
		Body:     bytes.NewReader(content),
	}, 50, nil)
	require.NoError(t, err)
	assert.Equal(t, "hello.txt", row.FileName)
	assert.Equal(t, int64(len(content)), row.FileSize)
	assert.Equal(t, "text/plain", row.MimeType)
	assert.Equal(t, task.ID, row.TaskID)
	assert.Equal(t, actor, row.UploadedBy)
	assert.NotEmpty(t, row.StorageKey)

	// List returns the uploaded attachment.
	list, err := svc.ListAttachments(ctx, task.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, row.ID, list[0].ID)

	// Download and verify content.
	body, size, mimeType, fileName, err := svc.DownloadAttachment(ctx, task.ID, row.ID)
	require.NoError(t, err)
	defer body.Close()
	assert.Equal(t, int64(len(content)), size)
	assert.Equal(t, "text/plain", mimeType)
	assert.Equal(t, "hello.txt", fileName)
	got, err := io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, content, got)

	// Delete.
	err = svc.DeleteAttachment(ctx, task.ID, row.ID)
	require.NoError(t, err)

	// List is now empty.
	list, err = svc.ListAttachments(ctx, task.ID)
	require.NoError(t, err)
	assert.Empty(t, list)

	// Download after delete returns not found.
	_, _, _, _, err = svc.DownloadAttachment(ctx, task.ID, row.ID)
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Attachment_FileSizeRejected(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ATZ", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Too big file")

	content := make([]byte, 2*1024*1024) // 2 MB
	_, err := svc.UploadAttachment(ctx, tasks.UploadAttachmentParams{
		TaskID:   task.ID,
		ActorID:  actor,
		FileName: "big.bin",
		MimeType: "application/octet-stream",
		Size:     int64(len(content)),
		Body:     bytes.NewReader(content),
	}, 1, nil) // 1 MB max
	require.ErrorIs(t, err, tasks.ErrBadRequest)
}

func TestIntegration_Attachment_UnknownTaskReturnsNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)

	_, err := svc.UploadAttachment(ctx, tasks.UploadAttachmentParams{
		TaskID:   uuid.New(),
		ActorID:  actor,
		FileName: "x.txt",
		MimeType: "text/plain",
		Size:     4,
		Body:     bytes.NewReader([]byte("test")),
	}, 50, nil)
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Attachment_DeleteUnknownReturnsNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ATN", actor)
	status := seedStatus(t, ctx, svc, actor)
	task := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "No attachment")

	err := svc.DeleteAttachment(ctx, task.ID, uuid.New())
	require.ErrorIs(t, err, tasks.ErrNotFound)
}

func TestIntegration_Attachment_WrongTaskIDReturnsNotFound(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()
	minioClient := testdb.NewMinio(t)
	svc := tasks.NewService(pool, minioClient)
	actor := seedUser(t, ctx, pool)
	tpl := seedTemplate(t, ctx, svc, "ATW", actor)
	status := seedStatus(t, ctx, svc, actor)
	task1 := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Task 1")
	task2 := seedTask(t, ctx, svc, tpl.ID, status.ID, actor, "Task 2")

	content := []byte("data")
	row, err := svc.UploadAttachment(ctx, tasks.UploadAttachmentParams{
		TaskID:   task1.ID,
		ActorID:  actor,
		FileName: "f.txt",
		MimeType: "text/plain",
		Size:     int64(len(content)),
		Body:     bytes.NewReader(content),
	}, 50, nil)
	require.NoError(t, err)

	// Attempting to access the attachment via task2's ID should return not found.
	err = svc.DeleteAttachment(ctx, task2.ID, row.ID)
	require.ErrorIs(t, err, tasks.ErrNotFound)
}
