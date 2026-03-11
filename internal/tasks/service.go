package tasks

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/sqlc-dev/pqtype"

	"msgnr/internal/gen/queries"
)

// pgErrCheckViolation is the Postgres SQLSTATE for check constraint violations.
const pgErrCheckViolation = "23514"

// Sentinel errors returned by the service.
var (
	ErrNotFound   = errors.New("not found")
	ErrConflict   = errors.New("conflict")
	ErrBadRequest = errors.New("bad request")
	ErrForbidden  = errors.New("forbidden")
)

const prefixMaxLen = 32
const maxCommentAttachments = 5

var (
	rePrefixValid    = regexp.MustCompile(`^[A-Z]+$`)
	reFieldCodeValid = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
)

// ---- Domain types ----

type TemplateRow struct {
	ID        uuid.UUID  `json:"id"`
	Prefix    string     `json:"prefix"`
	SortOrder int        `json:"sort_order"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	CreatedBy uuid.UUID  `json:"created_by"`
	UpdatedBy uuid.UUID  `json:"updated_by"`
}

type StatusRow struct {
	ID        uuid.UUID  `json:"id"`
	Code      string     `json:"code"`
	Name      string     `json:"name"`
	SortOrder int        `json:"sort_order"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	CreatedBy uuid.UUID  `json:"created_by"`
}

type DictionaryRow struct {
	ID             uuid.UUID `json:"id"`
	Code           string    `json:"code"`
	Name           string    `json:"name"`
	CurrentVersion int       `json:"current_version"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type DictionaryVersionRow struct {
	ID           uuid.UUID `json:"id"`
	DictionaryID uuid.UUID `json:"dictionary_id"`
	Version      int       `json:"version"`
	CreatedAt    time.Time `json:"created_at"`
	CreatedBy    uuid.UUID `json:"created_by"`
}

type DictionaryItemRow struct {
	ID                  uuid.UUID `json:"id"`
	DictionaryVersionID uuid.UUID `json:"dictionary_version_id"`
	ValueCode           string    `json:"value_code"`
	ValueName           string    `json:"value_name"`
	SortOrder           int       `json:"sort_order"`
	IsActive            bool      `json:"is_active"`
}

// ---- Input params ----

type CreateTemplateParams struct {
	Prefix    string
	SortOrder int
	ActorID   uuid.UUID
}

type UpdateTemplateParams struct {
	Prefix    string
	SortOrder *int
	ActorID   uuid.UUID
}

type CreateStatusParams struct {
	Code      string
	Name      string
	SortOrder int
	ActorID   uuid.UUID
}

// ActorID is carried for future audit trail support (task_status has no
// updated_by column yet; it will be added when history tracking is implemented).
type UpdateStatusParams struct {
	Code    string
	Name    string
	ActorID uuid.UUID
}

type CreateDictionaryParams struct {
	Code string
	Name string
}

type DictionaryItemInput struct {
	ValueCode string `json:"value_code"`
	ValueName string `json:"value_name"`
	SortOrder int    `json:"sort_order"`
	IsActive  bool   `json:"is_active"`
}

// ---- Field definition types ----

type FieldRow struct {
	ID               uuid.UUID  `json:"id"`
	TemplateID       uuid.UUID  `json:"template_id"`
	Code             string     `json:"code"`
	Name             string     `json:"name"`
	Type             string     `json:"type"`
	Required         bool       `json:"required"`
	SortOrder        int        `json:"sort_order"`
	EnumDictionaryID *uuid.UUID `json:"enum_dictionary_id,omitempty"`
	FieldRole        *string    `json:"field_role,omitempty"`
	DeletedAt        *time.Time `json:"deleted_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type CreateFieldParams struct {
	TemplateID       uuid.UUID
	Code             string
	Name             string
	Type             string
	Required         bool
	SortOrder        int
	EnumDictionaryID *uuid.UUID
	FieldRole        *string
}

type UpdateFieldParams struct {
	Name     string
	Required bool
}

// =========================================================
// Task domain types (Phase 3)
// =========================================================

// TaskRow is the task record returned by the service.
type TaskRow struct {
	ID                     uuid.UUID  `json:"id"`
	PublicID               string     `json:"public_id"`
	TemplateID             uuid.UUID  `json:"template_id"`
	TemplateSnapshotPrefix string     `json:"template_snapshot_prefix"`
	SequenceNumber         int64      `json:"sequence_number"`
	Title                  string     `json:"title"`
	Description            *string    `json:"description,omitempty"`
	StatusID               uuid.UUID  `json:"status_id"`
	ParentTaskID           *uuid.UUID `json:"parent_task_id,omitempty"`
	CreatedBy              uuid.UUID  `json:"created_by"`
	UpdatedBy              uuid.UUID  `json:"updated_by"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

// FieldValueRow is one custom field value record.
type FieldValueRow struct {
	ID                uuid.UUID       `json:"id"`
	TaskID            uuid.UUID       `json:"task_id"`
	FieldDefinitionID uuid.UUID       `json:"field_definition_id"`
	ValueText         *string         `json:"value_text,omitempty"`
	ValueNumber       *string         `json:"value_number,omitempty"`
	ValueUserID       *uuid.UUID      `json:"value_user_id,omitempty"`
	ValueDate         *string         `json:"value_date,omitempty"`
	ValueDatetime     *time.Time      `json:"value_datetime,omitempty"`
	ValueJSON         json.RawMessage `json:"value_json,omitempty"`
	EnumDictionaryID  *uuid.UUID      `json:"enum_dictionary_id,omitempty"`
	EnumVersion       *int32          `json:"enum_version,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// TaskResponse combines a task with its custom field values and subtasks.
// Subtasks is only populated for top-level tasks (ParentTaskID == nil).
// ParentPublicID is only populated for subtasks (ParentTaskID != nil).
type TaskResponse struct {
	TaskRow
	FieldValues    []FieldValueRow `json:"field_values"`
	Subtasks       []TaskRow       `json:"subtasks"`
	ParentPublicID *string         `json:"parent_public_id,omitempty"`
}

// =========================================================
// Attachment + Comment domain types (Phase 6)
// =========================================================

// AttachmentRow is one file attachment record returned by the service.
// StorageKey is intentionally excluded from JSON serialisation — it is an
// internal Minio path that must never be exposed to API consumers.
type AttachmentRow struct {
	ID         uuid.UUID `json:"id"`
	TaskID     uuid.UUID `json:"task_id"`
	FileName   string    `json:"file_name"`
	FileSize   int64     `json:"file_size"`
	MimeType   string    `json:"mime_type"`
	StorageKey string    `json:"-"`
	UploadedBy uuid.UUID `json:"uploaded_by"`
	CreatedAt  time.Time `json:"created_at"`
}

// CommentRow is one comment record returned by the service.
type CommentRow struct {
	ID          uuid.UUID              `json:"id"`
	TaskID      uuid.UUID              `json:"task_id"`
	AuthorID    uuid.UUID              `json:"author_id"`
	Body        string                 `json:"body"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	Attachments []CommentAttachmentRow `json:"attachments"`
}

// CommentAttachmentRow is one file attachment record linked to a task comment.
// StorageKey is internal and must never be exposed to API consumers.
type CommentAttachmentRow struct {
	ID         uuid.UUID  `json:"id"`
	TaskID     uuid.UUID  `json:"task_id"`
	CommentID  *uuid.UUID `json:"comment_id,omitempty"`
	FileName   string     `json:"file_name"`
	FileSize   int64      `json:"file_size"`
	MimeType   string     `json:"mime_type"`
	StorageKey string     `json:"-"`
	UploadedBy uuid.UUID  `json:"uploaded_by"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ByteCounter is satisfied by any reader wrapper that tracks bytes consumed.
// The handler passes a *countingReader; the service reads the final count after
// PutObject returns to verify the actual upload size.
type ByteCounter interface {
	BytesRead() int64
}

// UploadAttachmentParams carries inputs for uploading a file attachment.
// Size should be set to -1 when the caller cannot guarantee the value from the
// client (e.g. multipart header.Size); the service uses the ByteCounter to
// determine the real size after streaming.
type UploadAttachmentParams struct {
	TaskID   uuid.UUID
	ActorID  uuid.UUID
	FileName string
	MimeType string
	// Size is passed to the object store. Pass -1 to use streaming/chunked mode
	// when the true size is unknown upfront (the service will use ByteCounter).
	Size int64
	Body io.Reader
}

// UploadCommentAttachmentParams carries inputs for staged comment attachment upload.
type UploadCommentAttachmentParams struct {
	TaskID   uuid.UUID
	ActorID  uuid.UUID
	FileName string
	MimeType string
	Size     int64
	Body     io.Reader
}

// FieldValueInput is the typed-union input for one custom field value.
type FieldValueInput struct {
	FieldDefinitionID uuid.UUID       `json:"field_definition_id"`
	ValueText         *string         `json:"value_text"`
	ValueNumber       *string         `json:"value_number"`
	ValueUserID       *uuid.UUID      `json:"value_user_id"`
	ValueDate         *string         `json:"value_date"`
	ValueDatetime     *time.Time      `json:"value_datetime"`
	ValueJSON         json.RawMessage `json:"value_json"`
	EnumDictionaryID  *uuid.UUID      `json:"enum_dictionary_id"`
	EnumVersion       *int32          `json:"enum_version"`
}

// CreateTaskParams carries all inputs for task creation.
type CreateTaskParams struct {
	TemplateID   uuid.UUID
	ParentTaskID *uuid.UUID // nil for top-level tasks
	Title        string
	Description  *string
	StatusID     uuid.UUID
	FieldValues  []FieldValueInput
	ActorID      uuid.UUID
}

// UpdateTaskParams carries all inputs for a full task update.
// FieldValues replaces the entire set (replace-all semantics).
type UpdateTaskParams struct {
	Title       string
	Description *string
	StatusID    uuid.UUID
	FieldValues []FieldValueInput
	ActorID     uuid.UUID
}

// ---- Service ----

type Service struct {
	pool  *pgxpool.Pool
	q     *queries.Queries
	store Storage
}

// Storage is the interface the service uses for file object storage.
// It is satisfied by storage.MinioClient and by test fakes.
type Storage interface {
	PutObject(ctx context.Context, key string, r io.Reader, size int64, mimeType string) error
	GetObject(ctx context.Context, key string) (body io.ReadCloser, size int64, mimeType string, err error)
	DeleteObject(ctx context.Context, key string) error
}

func NewService(pool *pgxpool.Pool, store Storage) *Service {
	return &Service{
		pool:  pool,
		q:     queries.New(stdlib.OpenDBFromPool(pool)),
		store: store,
	}
}

// =========================================================
// Templates
// =========================================================

func (s *Service) ListTemplates(ctx context.Context, includeDeleted bool) ([]TemplateRow, error) {
	rows, err := s.q.TaskTemplateList(ctx, includeDeleted)
	if err != nil {
		return nil, fmt.Errorf("tasks: list templates: %w", err)
	}
	return mapTemplates(rows), nil
}

func (s *Service) GetTemplate(ctx context.Context, id uuid.UUID) (TemplateRow, error) {
	row, err := s.q.TaskTemplateGet(ctx, id)
	if err != nil {
		return TemplateRow{}, mapNotFound(err, "template")
	}
	return mapTemplate(row), nil
}

func (s *Service) CreateTemplate(ctx context.Context, p CreateTemplateParams) (TemplateRow, error) {
	if err := validatePrefix(p.Prefix); err != nil {
		return TemplateRow{}, err
	}
	row, err := s.q.TaskTemplateCreate(ctx, queries.TaskTemplateCreateParams{
		Prefix:    p.Prefix,
		SortOrder: p.SortOrder,
		CreatedBy: p.ActorID,
	})
	if err != nil {
		return TemplateRow{}, mapUniqueViolation(err, "prefix already exists")
	}
	return mapTemplate(row), nil
}

func (s *Service) UpdateTemplate(ctx context.Context, id uuid.UUID, p UpdateTemplateParams) (TemplateRow, error) {
	if err := validatePrefix(p.Prefix); err != nil {
		return TemplateRow{}, err
	}

	// Always run inside a pgx transaction so that prefix and sort_order changes
	// are atomic. Using raw tx.Exec for both columns avoids the sql.DB/pgx.Tx
	// boundary mismatch (s.q runs on *sql.DB, which is outside a pgx transaction).
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TemplateRow{}, fmt.Errorf("tasks: begin update template tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var sortOrder int
	if p.SortOrder != nil {
		sortOrder = *p.SortOrder
	}

	// WHERE deleted_at IS NULL guarantees the returned row is active, so
	// deleted_at is always NULL here — omit it from RETURNING to keep the scan
	// straightforward. TemplateRow.DeletedAt stays nil by zero-value.
	var row TemplateRow
	err = tx.QueryRow(ctx, `
		UPDATE task_template
		SET prefix     = $2,
		    updated_by = $3,
		    sort_order  = CASE WHEN $4 THEN $5::int ELSE sort_order END,
		    updated_at  = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, prefix, sort_order, created_at, updated_at, created_by, updated_by`,
		id, p.Prefix, p.ActorID,
		p.SortOrder != nil, sortOrder,
	).Scan(
		&row.ID, &row.Prefix, &row.SortOrder,
		&row.CreatedAt, &row.UpdatedAt,
		&row.CreatedBy, &row.UpdatedBy,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TemplateRow{}, fmt.Errorf("%w: template", ErrNotFound)
		}
		if isUniqueViolation(err) {
			return TemplateRow{}, fmt.Errorf("%w: prefix already exists", ErrConflict)
		}
		if isCheckViolation(err) {
			return TemplateRow{}, fmt.Errorf("%w: %s", ErrBadRequest, err)
		}
		return TemplateRow{}, fmt.Errorf("tasks: update template: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return TemplateRow{}, fmt.Errorf("tasks: commit update template tx: %w", err)
	}
	return row, nil
}

func (s *Service) SoftDeleteTemplate(ctx context.Context, id uuid.UUID, actorID uuid.UUID) (TemplateRow, error) {
	row, err := s.q.TaskTemplateSoftDelete(ctx, queries.TaskTemplateSoftDeleteParams{
		ID:        id,
		UpdatedBy: actorID,
	})
	if err != nil {
		return TemplateRow{}, mapNotFound(err, "template")
	}
	return mapTemplate(row), nil
}

// ReorderTemplates assigns sort_order 1…N to the given template IDs in order.
// Runs in a single transaction; duplicate or unknown IDs are rejected.
func (s *Service) ReorderTemplates(ctx context.Context, ids []uuid.UUID) error {
	return s.reorderInTx(ctx, ids, tableTaskTemplate, nil)
}

// =========================================================
// Statuses
// =========================================================

func (s *Service) ListStatuses(ctx context.Context, includeDeleted bool) ([]StatusRow, error) {
	rows, err := s.q.TaskStatusList(ctx, includeDeleted)
	if err != nil {
		return nil, fmt.Errorf("tasks: list statuses: %w", err)
	}
	return mapStatuses(rows), nil
}

func (s *Service) GetStatus(ctx context.Context, id uuid.UUID) (StatusRow, error) {
	row, err := s.q.TaskStatusGet(ctx, id)
	if err != nil {
		return StatusRow{}, mapNotFound(err, "status")
	}
	return mapStatus(row), nil
}

func (s *Service) CreateStatus(ctx context.Context, p CreateStatusParams) (StatusRow, error) {
	if strings.TrimSpace(p.Code) == "" || strings.TrimSpace(p.Name) == "" {
		return StatusRow{}, fmt.Errorf("%w: code and name are required", ErrBadRequest)
	}
	row, err := s.q.TaskStatusCreate(ctx, queries.TaskStatusCreateParams{
		Code:      p.Code,
		Name:      p.Name,
		SortOrder: p.SortOrder,
		CreatedBy: p.ActorID,
	})
	if err != nil {
		return StatusRow{}, mapUniqueViolation(err, "code already exists")
	}
	return mapStatus(row), nil
}

func (s *Service) UpdateStatus(ctx context.Context, id uuid.UUID, p UpdateStatusParams) (StatusRow, error) {
	if strings.TrimSpace(p.Code) == "" || strings.TrimSpace(p.Name) == "" {
		return StatusRow{}, fmt.Errorf("%w: code and name are required", ErrBadRequest)
	}
	row, err := s.q.TaskStatusUpdate(ctx, queries.TaskStatusUpdateParams{
		ID:   id,
		Code: p.Code,
		Name: p.Name,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return StatusRow{}, fmt.Errorf("%w: code already exists", ErrConflict)
		}
		return StatusRow{}, mapNotFound(err, "status")
	}
	return mapStatus(row), nil
}

func (s *Service) SoftDeleteStatus(ctx context.Context, id uuid.UUID) (StatusRow, error) {
	row, err := s.q.TaskStatusSoftDelete(ctx, id)
	if err != nil {
		return StatusRow{}, mapNotFound(err, "status")
	}
	return mapStatus(row), nil
}

// ReorderStatuses assigns sort_order 1…N to the given status IDs in order.
// Runs in a single transaction; duplicate or unknown IDs are rejected.
func (s *Service) ReorderStatuses(ctx context.Context, ids []uuid.UUID) error {
	return s.reorderInTx(ctx, ids, tableTaskStatus, nil)
}

// =========================================================
// Enum dictionaries
// =========================================================

func (s *Service) ListDictionaries(ctx context.Context) ([]DictionaryRow, error) {
	rows, err := s.q.EnumDictionaryList(ctx)
	if err != nil {
		return nil, fmt.Errorf("tasks: list dictionaries: %w", err)
	}
	return mapDictionaries(rows), nil
}

func (s *Service) GetDictionary(ctx context.Context, id uuid.UUID) (DictionaryRow, error) {
	row, err := s.q.EnumDictionaryGet(ctx, id)
	if err != nil {
		return DictionaryRow{}, mapNotFound(err, "dictionary")
	}
	return mapDictionary(row), nil
}

func (s *Service) CreateDictionary(ctx context.Context, p CreateDictionaryParams) (DictionaryRow, error) {
	if strings.TrimSpace(p.Code) == "" || strings.TrimSpace(p.Name) == "" {
		return DictionaryRow{}, fmt.Errorf("%w: code and name are required", ErrBadRequest)
	}
	row, err := s.q.EnumDictionaryCreate(ctx, queries.EnumDictionaryCreateParams{
		Code: p.Code,
		Name: p.Name,
	})
	if err != nil {
		return DictionaryRow{}, mapUniqueViolation(err, "code already exists")
	}
	return mapDictionary(row), nil
}

// CreateDictionaryVersion creates a new version with the provided items inside
// a single transaction. The version number is taken from the atomic
// EnumDictionaryIncrementVersion query result, eliminating the TOCTOU race.
func (s *Service) CreateDictionaryVersion(
	ctx context.Context,
	dictID uuid.UUID,
	items []DictionaryItemInput,
	actorID uuid.UUID,
) (DictionaryVersionRow, error) {
	if len(items) == 0 {
		return DictionaryVersionRow{}, fmt.Errorf("%w: items list must not be empty", ErrBadRequest)
	}
	for _, it := range items {
		if strings.TrimSpace(it.ValueCode) == "" || strings.TrimSpace(it.ValueName) == "" {
			return DictionaryVersionRow{}, fmt.Errorf("%w: every item needs a value_code and value_name", ErrBadRequest)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DictionaryVersionRow{}, fmt.Errorf("tasks: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Lock the dictionary row and increment version atomically.
	// newVersion is read directly from RETURNING — no TOCTOU race.
	var newVersion int
	err = tx.QueryRow(ctx,
		`UPDATE enum_dictionary
		 SET current_version = current_version + 1, updated_at = now()
		 WHERE id = $1
		 RETURNING current_version`,
		dictID,
	).Scan(&newVersion)
	if err != nil {
		return DictionaryVersionRow{}, mapNotFound(err, "dictionary")
	}

	// Insert the version record.
	var ver queries.EnumDictionaryVersion
	err = tx.QueryRow(ctx,
		`INSERT INTO enum_dictionary_version (dictionary_id, version, created_by)
		 VALUES ($1, $2, $3)
		 RETURNING id, dictionary_id, version, created_at, created_by`,
		dictID, newVersion, actorID,
	).Scan(&ver.ID, &ver.DictionaryID, &ver.Version, &ver.CreatedAt, &ver.CreatedBy)
	if err != nil {
		return DictionaryVersionRow{}, fmt.Errorf("tasks: insert version: %w", err)
	}

	// Insert all items.
	for _, it := range items {
		_, err := tx.Exec(ctx,
			`INSERT INTO enum_dictionary_version_item
			 (dictionary_version_id, value_code, value_name, sort_order, is_active)
			 VALUES ($1, $2, $3, $4, $5)`,
			ver.ID, it.ValueCode, it.ValueName, it.SortOrder, it.IsActive,
		)
		if err != nil {
			return DictionaryVersionRow{}, mapUniqueViolation(
				err,
				fmt.Sprintf("duplicate value_code %q in this version", it.ValueCode),
			)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return DictionaryVersionRow{}, fmt.Errorf("tasks: commit version tx: %w", err)
	}
	return mapDictionaryVersion(ver), nil
}

func (s *Service) ListDictionaryVersions(ctx context.Context, dictID uuid.UUID) ([]DictionaryVersionRow, error) {
	rows, err := s.q.EnumDictionaryVersionList(ctx, dictID)
	if err != nil {
		return nil, fmt.Errorf("tasks: list versions: %w", err)
	}
	return mapDictionaryVersions(rows), nil
}

func (s *Service) GetDictionaryVersionItems(ctx context.Context, versionID uuid.UUID) ([]DictionaryItemRow, error) {
	rows, err := s.q.EnumDictionaryVersionItemList(ctx, versionID)
	if err != nil {
		return nil, fmt.Errorf("tasks: list version items: %w", err)
	}
	return mapDictionaryItems(rows), nil
}

// =========================================================
// Field definitions
// =========================================================

func (s *Service) ListFields(ctx context.Context, templateID uuid.UUID, includeDeleted bool) ([]FieldRow, error) {
	rows, err := s.q.TaskFieldList(ctx, queries.TaskFieldListParams{
		TemplateID: templateID,
		Column2:    includeDeleted,
	})
	if err != nil {
		return nil, fmt.Errorf("tasks: list fields: %w", err)
	}
	return mapFields(rows), nil
}

func (s *Service) GetField(ctx context.Context, templateID, id uuid.UUID) (FieldRow, error) {
	row, err := s.q.TaskFieldGet(ctx, queries.TaskFieldGetParams{
		ID:         id,
		TemplateID: templateID,
	})
	if err != nil {
		return FieldRow{}, mapNotFound(err, "field")
	}
	return mapField(row), nil
}

func (s *Service) CreateField(ctx context.Context, p CreateFieldParams) (FieldRow, error) {
	if err := validateFieldCode(p.Code); err != nil {
		return FieldRow{}, err
	}
	if strings.TrimSpace(p.Name) == "" {
		return FieldRow{}, fmt.Errorf("%w: name is required", ErrBadRequest)
	}
	if p.SortOrder < 1 {
		return FieldRow{}, fmt.Errorf("%w: sort_order must be >= 1", ErrBadRequest)
	}

	row, err := s.q.TaskFieldCreate(ctx, queries.TaskFieldCreateParams{
		TemplateID:       p.TemplateID,
		Code:             p.Code,
		Name:             p.Name,
		Type:             p.Type,
		Required:         p.Required,
		SortOrder:        p.SortOrder,
		EnumDictionaryID: nullUUID(p.EnumDictionaryID),
		FieldRole:        nullString(p.FieldRole),
	})
	if err != nil {
		return FieldRow{}, mapFieldCreateError(err)
	}
	return mapField(row), nil
}

func (s *Service) UpdateField(ctx context.Context, templateID, id uuid.UUID, p UpdateFieldParams) (FieldRow, error) {
	if strings.TrimSpace(p.Name) == "" {
		return FieldRow{}, fmt.Errorf("%w: name is required", ErrBadRequest)
	}
	row, err := s.q.TaskFieldUpdate(ctx, queries.TaskFieldUpdateParams{
		ID:         id,
		Name:       p.Name,
		Required:   p.Required,
		TemplateID: templateID,
	})
	if err != nil {
		return FieldRow{}, mapNotFound(err, "field")
	}
	return mapField(row), nil
}

func (s *Service) SoftDeleteField(ctx context.Context, templateID, id uuid.UUID) (FieldRow, error) {
	row, err := s.q.TaskFieldSoftDelete(ctx, queries.TaskFieldSoftDeleteParams{
		ID:         id,
		TemplateID: templateID,
	})
	if err != nil {
		return FieldRow{}, mapNotFound(err, "field")
	}
	return mapField(row), nil
}

// ReorderFields sets sort_order 1…N for the given field IDs, scoped to templateID.
func (s *Service) ReorderFields(ctx context.Context, templateID uuid.UUID, ids []uuid.UUID) error {
	return s.reorderInTx(ctx, ids, tableTaskFieldDef, &templateID)
}

// =========================================================
// Helpers
// =========================================================

func validatePrefix(prefix string) error {
	if strings.TrimSpace(prefix) == "" {
		return fmt.Errorf("%w: prefix is required", ErrBadRequest)
	}
	if len(prefix) > prefixMaxLen {
		return fmt.Errorf("%w: prefix must be at most %d characters", ErrBadRequest, prefixMaxLen)
	}
	if !rePrefixValid.MatchString(prefix) {
		return fmt.Errorf("%w: prefix must contain only uppercase Latin letters (A-Z)", ErrBadRequest)
	}
	return nil
}

// reorderTable is a typed allowlist of tables that reorderInTx may update.
// This prevents any SQL injection risk if a future caller passes untrusted input.
type reorderTable string

const (
	tableTaskTemplate reorderTable = "task_template"
	tableTaskStatus   reorderTable = "task_status"
	tableTaskFieldDef reorderTable = "task_field_definition"
)

// reorderInTx sets sort_order 1…N for the given IDs in a single transaction.
// Rejects duplicate IDs. When scopeID is non-nil, the UPDATE is additionally
// filtered by template_id = $3 — this prevents cross-template ID smuggling.
func (s *Service) reorderInTx(ctx context.Context, ids []uuid.UUID, table reorderTable, scopeID *uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if _, dup := seen[id]; dup {
			return fmt.Errorf("%w: duplicate id %s in reorder list", ErrBadRequest, id)
		}
		seen[id] = struct{}{}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("tasks: begin reorder tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// table is a typed constant — no user input reaches this format string.
	var stmt string
	if scopeID != nil {
		stmt = fmt.Sprintf(
			"UPDATE %s SET sort_order = $2, updated_at = now() WHERE id = $1 AND template_id = $3",
			table,
		)
	} else {
		stmt = fmt.Sprintf(
			"UPDATE %s SET sort_order = $2, updated_at = now() WHERE id = $1",
			table,
		)
	}

	for i, id := range ids {
		var execErr error
		if scopeID != nil {
			_, execErr = tx.Exec(ctx, stmt, id, i+1, *scopeID)
		} else {
			_, execErr = tx.Exec(ctx, stmt, id, i+1)
		}
		if execErr != nil {
			return fmt.Errorf("tasks: reorder %s %s: %w", table, id, execErr)
		}
	}

	return tx.Commit(ctx)
}

// mapNotFound converts sql.ErrNoRows to ErrNotFound.
func mapNotFound(err error, entity string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrNotFound, entity)
	}
	return fmt.Errorf("tasks: %s: %w", entity, err)
}

// isUniqueViolation returns true for Postgres unique-constraint violations (23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// mapUniqueViolation wraps a unique-violation error as ErrConflict, or falls
// back to a generic wrap for other errors.
func mapUniqueViolation(err error, msg string) error {
	if isUniqueViolation(err) {
		return fmt.Errorf("%w: %s", ErrConflict, msg)
	}
	return fmt.Errorf("tasks: %w", err)
}

// isCheckViolation returns true for Postgres check-constraint violations (23514).
func isCheckViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgErrCheckViolation
}

// pgConstraintName extracts the constraint name from a Postgres error, or "".
func pgConstraintName(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}

// mapFieldCreateError maps DB errors from TaskFieldCreate to service errors.
// Differentiates between:
//   - check constraint violation → ErrBadRequest (bad type/enum/role config)
//   - unique violation on assignee index → ErrConflict "only one assignee field allowed"
//   - unique violation on code index → ErrConflict "field code already exists"
func mapFieldCreateError(err error) error {
	switch {
	case isCheckViolation(err):
		return fmt.Errorf("%w: invalid field configuration (check type, enum_dictionary_id, field_role combination)", ErrBadRequest)
	case isUniqueViolation(err):
		if pgConstraintName(err) == "uq_task_field_definition_one_assignee" {
			return fmt.Errorf("%w: only one assignee field is allowed per template", ErrConflict)
		}
		return fmt.Errorf("%w: field code already exists for this template", ErrConflict)
	default:
		return fmt.Errorf("tasks: %w", err)
	}
}

func validateFieldCode(code string) error {
	if !reFieldCodeValid.MatchString(strings.TrimSpace(code)) {
		return fmt.Errorf("%w: code must match ^[a-z][a-z0-9_]*$", ErrBadRequest)
	}
	return nil
}

// nullUUID converts *uuid.UUID to uuid.NullUUID for sqlc.
func nullUUID(u *uuid.UUID) uuid.NullUUID {
	if u == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *u, Valid: true}
}

// nullString converts *string to sql.NullString for sqlc.
func nullString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

// ---- Mappers: queries → domain types ----

func mapTemplate(r queries.TaskTemplate) TemplateRow {
	t := TemplateRow{
		ID:        r.ID,
		Prefix:    r.Prefix,
		SortOrder: r.SortOrder,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
		CreatedBy: r.CreatedBy,
		UpdatedBy: r.UpdatedBy,
	}
	if r.DeletedAt.Valid {
		t.DeletedAt = &r.DeletedAt.Time
	}
	return t
}

func mapTemplates(rows []queries.TaskTemplate) []TemplateRow {
	out := make([]TemplateRow, len(rows))
	for i, r := range rows {
		out[i] = mapTemplate(r)
	}
	return out
}

func mapStatus(r queries.TaskStatus) StatusRow {
	s := StatusRow{
		ID:        r.ID,
		Code:      r.Code,
		Name:      r.Name,
		SortOrder: r.SortOrder,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
		CreatedBy: r.CreatedBy,
	}
	if r.DeletedAt.Valid {
		s.DeletedAt = &r.DeletedAt.Time
	}
	return s
}

func mapStatuses(rows []queries.TaskStatus) []StatusRow {
	out := make([]StatusRow, len(rows))
	for i, r := range rows {
		out[i] = mapStatus(r)
	}
	return out
}

func mapDictionary(r queries.EnumDictionary) DictionaryRow {
	return DictionaryRow{
		ID:             r.ID,
		Code:           r.Code,
		Name:           r.Name,
		CurrentVersion: r.CurrentVersion,
		CreatedAt:      r.CreatedAt,
		UpdatedAt:      r.UpdatedAt,
	}
}

func mapDictionaries(rows []queries.EnumDictionary) []DictionaryRow {
	out := make([]DictionaryRow, len(rows))
	for i, r := range rows {
		out[i] = mapDictionary(r)
	}
	return out
}

func mapDictionaryVersion(r queries.EnumDictionaryVersion) DictionaryVersionRow {
	return DictionaryVersionRow{
		ID:           r.ID,
		DictionaryID: r.DictionaryID,
		Version:      r.Version,
		CreatedAt:    r.CreatedAt,
		CreatedBy:    r.CreatedBy,
	}
}

func mapDictionaryVersions(rows []queries.EnumDictionaryVersion) []DictionaryVersionRow {
	out := make([]DictionaryVersionRow, len(rows))
	for i, r := range rows {
		out[i] = mapDictionaryVersion(r)
	}
	return out
}

func mapDictionaryItem(r queries.EnumDictionaryVersionItem) DictionaryItemRow {
	return DictionaryItemRow{
		ID:                  r.ID,
		DictionaryVersionID: r.DictionaryVersionID,
		ValueCode:           r.ValueCode,
		ValueName:           r.ValueName,
		SortOrder:           r.SortOrder,
		IsActive:            r.IsActive,
	}
}

func mapDictionaryItems(rows []queries.EnumDictionaryVersionItem) []DictionaryItemRow {
	out := make([]DictionaryItemRow, len(rows))
	for i, r := range rows {
		out[i] = mapDictionaryItem(r)
	}
	return out
}

func mapField(r queries.TaskFieldDefinition) FieldRow {
	f := FieldRow{
		ID:         r.ID,
		TemplateID: r.TemplateID,
		Code:       r.Code,
		Name:       r.Name,
		Type:       r.Type,
		Required:   r.Required,
		SortOrder:  r.SortOrder,
		CreatedAt:  r.CreatedAt,
		UpdatedAt:  r.UpdatedAt,
	}
	if r.EnumDictionaryID.Valid {
		id := r.EnumDictionaryID.UUID
		f.EnumDictionaryID = &id
	}
	if r.FieldRole.Valid {
		f.FieldRole = &r.FieldRole.String
	}
	if r.DeletedAt.Valid {
		f.DeletedAt = &r.DeletedAt.Time
	}
	return f
}

func mapFields(rows []queries.TaskFieldDefinition) []FieldRow {
	out := make([]FieldRow, len(rows))
	for i, r := range rows {
		out[i] = mapField(r)
	}
	return out
}

// =========================================================
// Tasks — Phase 3
// =========================================================

// CreateTask creates a new task for the given template inside a transaction.
// The DB trigger handles public_id generation and blocks deleted templates/statuses.
func (s *Service) CreateTask(ctx context.Context, p CreateTaskParams) (TaskResponse, error) {
	if strings.TrimSpace(p.Title) == "" {
		return TaskResponse{}, fmt.Errorf("%w: title is required", ErrBadRequest)
	}

	// Verify the specific template exists and is not soft-deleted before opening
	// a transaction. This gives a clear app-level error rather than relying solely
	// on the DB trigger message. The trigger remains the authoritative enforcement.
	tpl, err := s.q.TaskTemplateGet(ctx, p.TemplateID)
	if err != nil {
		return TaskResponse{}, mapNotFound(err, "template")
	}
	if tpl.DeletedAt.Valid {
		return TaskResponse{}, fmt.Errorf("%w: template has been deleted", ErrBadRequest)
	}

	// Validate parent task if provided: it must exist and must not itself be a subtask.
	if p.ParentTaskID != nil {
		parent, err := s.q.TaskGet(ctx, *p.ParentTaskID)
		if err != nil {
			return TaskResponse{}, mapNotFound(err, "parent task")
		}
		if parent.ParentTaskID.Valid {
			return TaskResponse{}, fmt.Errorf("%w: parent task is already a subtask", ErrBadRequest)
		}
	}

	// Load active field definitions and validate required fields before any writes.
	defs, err := s.q.TaskFieldDefinitionListActive(ctx, p.TemplateID)
	if err != nil {
		return TaskResponse{}, fmt.Errorf("tasks: load field definitions: %w", err)
	}
	if err := validateRequiredFields(defs, p.FieldValues); err != nil {
		return TaskResponse{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TaskResponse{}, fmt.Errorf("tasks: begin create task tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Raw pgx tx query mirrors the sqlc TaskCreate query. The sqlc-generated path
	// (s.q.TaskCreate) cannot join a pgx transaction because s.q is bound to a
	// *sql.DB pool. We keep the SQL identical to the sqlc source so both are in sync.
	taskRow, err := scanTask(tx.QueryRow(ctx,
		`INSERT INTO task (template_id, parent_task_id, title, description, status_id, created_by, updated_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $6)
		 RETURNING `+taskColumns,
		p.TemplateID, nullUUID(p.ParentTaskID), p.Title, nullableString(p.Description), p.StatusID, p.ActorID,
	))
	if err != nil {
		return TaskResponse{}, mapTaskWriteError(err)
	}

	fieldValues, err := upsertFieldValuesInTx(ctx, tx, taskRow.ID, p.FieldValues)
	if err != nil {
		return TaskResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return TaskResponse{}, fmt.Errorf("tasks: commit create task tx: %w", err)
	}
	return TaskResponse{TaskRow: taskRow, FieldValues: fieldValues}, nil
}

// GetTask fetches a task by ID with its custom field values.
// For top-level tasks (no parent) it also fetches the immediate subtasks.
// For subtasks it fetches the parent's public_id for breadcrumb display.
func (s *Service) GetTask(ctx context.Context, id uuid.UUID) (TaskResponse, error) {
	row, err := s.q.TaskGet(ctx, id)
	if err != nil {
		return TaskResponse{}, mapNotFound(err, "task")
	}
	task := mapTask(row)

	fvRows, err := s.q.TaskFieldValueList(ctx, id)
	if err != nil {
		return TaskResponse{}, fmt.Errorf("tasks: list field values: %w", err)
	}

	resp := TaskResponse{TaskRow: task, FieldValues: mapFieldValues(fvRows), Subtasks: []TaskRow{}}

	if task.ParentTaskID == nil {
		resp.Subtasks, err = s.GetSubtasks(ctx, id)
		if err != nil {
			return TaskResponse{}, err
		}
	} else {
		parent, err := s.q.TaskGet(ctx, *task.ParentTaskID)
		if err == nil {
			resp.ParentPublicID = &parent.PublicID
		}
	}

	return resp, nil
}

// GetSubtasks returns all direct children of parentID ordered by creation time.
func (s *Service) GetSubtasks(ctx context.Context, parentID uuid.UUID) ([]TaskRow, error) {
	qrows, err := s.q.TaskSubtaskList(ctx, uuid.NullUUID{UUID: parentID, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("tasks: get subtasks: %w", err)
	}
	out := make([]TaskRow, 0, len(qrows))
	for _, r := range qrows {
		out = append(out, mapTask(r))
	}
	return out, nil
}

// UpdateTask updates a task's system fields and replaces all field values
// (replace-all: values not in p.FieldValues are deleted).
func (s *Service) UpdateTask(ctx context.Context, id uuid.UUID, p UpdateTaskParams) (TaskResponse, error) {
	if strings.TrimSpace(p.Title) == "" {
		return TaskResponse{}, fmt.Errorf("%w: title is required", ErrBadRequest)
	}

	// Load the task to get its template_id for required-field validation.
	// This also confirms the task exists before we open a transaction.
	existing, err := s.q.TaskGet(ctx, id)
	if err != nil {
		return TaskResponse{}, mapNotFound(err, "task")
	}

	defs, err := s.q.TaskFieldDefinitionListActive(ctx, existing.TemplateID)
	if err != nil {
		return TaskResponse{}, fmt.Errorf("tasks: load field definitions: %w", err)
	}
	if err := validateRequiredFields(defs, p.FieldValues); err != nil {
		return TaskResponse{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TaskResponse{}, fmt.Errorf("tasks: begin update task tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Raw pgx tx query mirrors the sqlc TaskUpdate query. See CreateTask comment.
	var taskRow TaskRow
	taskRow, err = scanTask(tx.QueryRow(ctx,
		`UPDATE task
		 SET title = $2, description = $3, status_id = $4, updated_by = $5, updated_at = now()
		 WHERE id = $1
		 RETURNING `+taskColumns,
		id, p.Title, nullableString(p.Description), p.StatusID, p.ActorID,
	))
	if err != nil {
		return TaskResponse{}, mapTaskWriteError(err)
	}

	_, err = upsertFieldValuesInTx(ctx, tx, taskRow.ID, p.FieldValues)
	if err != nil {
		return TaskResponse{}, err
	}

	// Delete field values not present in the request (replace-all semantics).
	keepIDs := fieldDefinitionIDs(p.FieldValues)
	if _, err := tx.Exec(ctx,
		`DELETE FROM task_field_value
		 WHERE task_id = $1 AND field_definition_id != ALL($2::uuid[])`,
		taskRow.ID, keepIDs,
	); err != nil {
		return TaskResponse{}, fmt.Errorf("tasks: delete stale field values: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return TaskResponse{}, fmt.Errorf("tasks: commit update task tx: %w", err)
	}

	// Re-fetch the committed state from DB to return an accurate post-commit snapshot.
	return s.GetTask(ctx, taskRow.ID)
}

// =========================================================
// Task helpers
// =========================================================

// taskColumns is the explicit column list for task RETURNING / SELECT clauses.
// Explicit enumeration prevents silent column-order breakage if the schema
// gains new columns. Must stay in sync with scanTask's Scan call.
const taskColumns = `id, public_id, template_id, template_snapshot_prefix, sequence_number,
	title, description, status_id, parent_task_id,
	created_by, updated_by, created_at, updated_at`

// validateRequiredFields checks that every required active field is present and
// carries at least one non-nil value column. A FieldValueInput that references a
// required field but has all value columns nil is treated as missing.
func validateRequiredFields(defs []queries.TaskFieldDefinition, inputs []FieldValueInput) error {
	provided := make(map[uuid.UUID]FieldValueInput, len(inputs))
	for _, fv := range inputs {
		provided[fv.FieldDefinitionID] = fv
	}
	for _, def := range defs {
		if !def.Required {
			continue
		}
		fv, ok := provided[def.ID]
		if !ok {
			return fmt.Errorf("%w: required field %q is missing", ErrBadRequest, def.Code)
		}
		if !fieldValueInputHasValue(fv) {
			return fmt.Errorf("%w: required field %q has no value", ErrBadRequest, def.Code)
		}
	}
	return nil
}

// fieldValueInputHasValue returns true when at least one value column is set.
func fieldValueInputHasValue(fv FieldValueInput) bool {
	return fv.ValueText != nil ||
		fv.ValueNumber != nil ||
		fv.ValueUserID != nil ||
		fv.ValueDate != nil ||
		fv.ValueDatetime != nil ||
		(len(fv.ValueJSON) > 0 && string(fv.ValueJSON) != "null")
}

// upsertFieldValuesInTx persists each FieldValueInput inside an open pgx transaction.
func upsertFieldValuesInTx(ctx context.Context, tx pgx.Tx, taskID uuid.UUID, inputs []FieldValueInput) ([]FieldValueRow, error) {
	out := make([]FieldValueRow, 0, len(inputs))
	for _, fv := range inputs {
		row, err := upsertOneFieldValue(ctx, tx, taskID, fv)
		if err != nil {
			return nil, fmt.Errorf("tasks: upsert field %s: %w", fv.FieldDefinitionID, err)
		}
		out = append(out, row)
	}
	return out, nil
}

func upsertOneFieldValue(ctx context.Context, tx pgx.Tx, taskID uuid.UUID, fv FieldValueInput) (FieldValueRow, error) {
	var rawJSON pqtype.NullRawMessage
	if len(fv.ValueJSON) > 0 && string(fv.ValueJSON) != "null" {
		rawJSON = pqtype.NullRawMessage{RawMessage: fv.ValueJSON, Valid: true}
	}

	var row FieldValueRow
	err := tx.QueryRow(ctx, `
		INSERT INTO task_field_value
		    (task_id, field_definition_id, value_text, value_number, value_user_id,
		     value_date, value_datetime, value_json, enum_dictionary_id, enum_version)
		VALUES ($1, $2, $3, $4::numeric, $5, $6::date, $7, $8, $9, $10)
		ON CONFLICT (task_id, field_definition_id) DO UPDATE SET
		    value_text         = EXCLUDED.value_text,
		    value_number       = EXCLUDED.value_number,
		    value_user_id      = EXCLUDED.value_user_id,
		    value_date         = EXCLUDED.value_date,
		    value_datetime     = EXCLUDED.value_datetime,
		    value_json         = EXCLUDED.value_json,
		    enum_dictionary_id = EXCLUDED.enum_dictionary_id,
		    enum_version       = EXCLUDED.enum_version,
		    updated_at         = now()
		RETURNING id, task_id, field_definition_id,
		          value_text, value_number::text, value_user_id,
		          value_date::text, value_datetime, value_json,
		          enum_dictionary_id, enum_version,
		          created_at, updated_at`,
		taskID,
		fv.FieldDefinitionID,
		nullableString(fv.ValueText),
		nullableString(fv.ValueNumber),
		nullUUID(fv.ValueUserID),
		nullableString(fv.ValueDate),
		fv.ValueDatetime,
		rawJSON,
		nullUUID(fv.EnumDictionaryID),
		nullInt32Ptr(fv.EnumVersion),
	).Scan(
		&row.ID, &row.TaskID, &row.FieldDefinitionID,
		&row.ValueText, &row.ValueNumber, &row.ValueUserID,
		&row.ValueDate, &row.ValueDatetime, &row.ValueJSON,
		&row.EnumDictionaryID, &row.EnumVersion,
		&row.CreatedAt, &row.UpdatedAt,
	)
	if err != nil {
		return FieldValueRow{}, mapTaskWriteError(err)
	}
	return row, nil
}

// scanner is the minimal interface shared by pgx.Row and pgx.Rows.
type scanner interface {
	Scan(dest ...any) error
}

// scanOneTask scans the taskSelectColumns columns from any scanner (pgx.Row or
// pgx.Rows). It is the single source of truth for task column order; both
// scanTask (single RETURNING row) and the ListTasks rows loop call it.
func scanOneTask(s scanner) (TaskRow, error) {
	var (
		id, templateID, statusID, createdBy, updatedBy uuid.UUID
		publicID, snapshotPrefix, title                string
		description                                    sql.NullString
		parentTaskID                                   uuid.NullUUID
		seqNum                                         int64
		createdAt, updatedAt                           time.Time
	)
	if err := s.Scan(
		&id, &publicID, &templateID, &snapshotPrefix, &seqNum,
		&title, &description, &statusID,
		&parentTaskID, &createdBy, &updatedBy,
		&createdAt, &updatedAt,
	); err != nil {
		return TaskRow{}, err
	}
	t := TaskRow{
		ID:                     id,
		PublicID:               publicID,
		TemplateID:             templateID,
		TemplateSnapshotPrefix: snapshotPrefix,
		SequenceNumber:         seqNum,
		Title:                  title,
		StatusID:               statusID,
		CreatedBy:              createdBy,
		UpdatedBy:              updatedBy,
		CreatedAt:              createdAt,
		UpdatedAt:              updatedAt,
	}
	if description.Valid {
		t.Description = &description.String
	}
	if parentTaskID.Valid {
		t.ParentTaskID = &parentTaskID.UUID
	}
	return t, nil
}

// scanTask wraps scanOneTask for the single-row (RETURNING) case.
func scanTask(row pgx.Row) (TaskRow, error) {
	return scanOneTask(row)
}

// scanOneTaskWithTotal scans the 13 taskSelectColumns followed by the window-
// function column status_total in one Scan call.  Used by the ListTasks rows
// loop where the SELECT list is taskSelectColumns + status_total.
func scanOneTaskWithTotal(s scanner, statusTotal *int) (TaskRow, error) {
	var (
		id, templateID, statusID, createdBy, updatedBy uuid.UUID
		publicID, snapshotPrefix, title                string
		description                                    sql.NullString
		parentTaskID                                   uuid.NullUUID
		seqNum                                         int64
		createdAt, updatedAt                           time.Time
	)
	if err := s.Scan(
		&id, &publicID, &templateID, &snapshotPrefix, &seqNum,
		&title, &description, &statusID,
		&parentTaskID, &createdBy, &updatedBy,
		&createdAt, &updatedAt,
		statusTotal,
	); err != nil {
		return TaskRow{}, err
	}
	t := TaskRow{
		ID:                     id,
		PublicID:               publicID,
		TemplateID:             templateID,
		TemplateSnapshotPrefix: snapshotPrefix,
		SequenceNumber:         seqNum,
		Title:                  title,
		StatusID:               statusID,
		CreatedBy:              createdBy,
		UpdatedBy:              updatedBy,
		CreatedAt:              createdAt,
		UpdatedAt:              updatedAt,
	}
	if description.Valid {
		t.Description = &description.String
	}
	if parentTaskID.Valid {
		t.ParentTaskID = &parentTaskID.UUID
	}
	return t, nil
}

// fieldDefinitionIDs extracts the FieldDefinitionID from each input.
func fieldDefinitionIDs(inputs []FieldValueInput) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(inputs))
	for _, fv := range inputs {
		ids = append(ids, fv.FieldDefinitionID)
	}
	return ids
}

// mapTaskWriteError maps DB errors to service errors.
func mapTaskWriteError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: task", ErrNotFound)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case pgErrCheckViolation:
			return fmt.Errorf("%w: %s", ErrBadRequest, pgErr.Message)
		case "23503":
			return fmt.Errorf("%w: %s", ErrBadRequest, pgErr.Message)
		case "23505":
			return fmt.Errorf("%w: %s", ErrConflict, pgErr.Message)
		}
	}
	return fmt.Errorf("tasks: %w", err)
}

// ---- Mappers: queries → domain types ----

func mapTask(r queries.Task) TaskRow {
	t := TaskRow{
		ID:                     r.ID,
		PublicID:               r.PublicID,
		TemplateID:             r.TemplateID,
		TemplateSnapshotPrefix: r.TemplateSnapshotPrefix,
		SequenceNumber:         r.SequenceNumber,
		Title:                  r.Title,
		StatusID:               r.StatusID,
		CreatedBy:              r.CreatedBy,
		UpdatedBy:              r.UpdatedBy,
		CreatedAt:              r.CreatedAt,
		UpdatedAt:              r.UpdatedAt,
	}
	if r.Description.Valid {
		t.Description = &r.Description.String
	}
	if r.ParentTaskID.Valid {
		t.ParentTaskID = &r.ParentTaskID.UUID
	}
	return t
}

func mapFieldValue(r queries.TaskFieldValue) FieldValueRow {
	fv := FieldValueRow{
		ID:                r.ID,
		TaskID:            r.TaskID,
		FieldDefinitionID: r.FieldDefinitionID,
		CreatedAt:         r.CreatedAt,
		UpdatedAt:         r.UpdatedAt,
	}
	if r.ValueText.Valid {
		fv.ValueText = &r.ValueText.String
	}
	if r.ValueNumber.Valid {
		fv.ValueNumber = &r.ValueNumber.String
	}
	if r.ValueUserID.Valid {
		fv.ValueUserID = &r.ValueUserID.UUID
	}
	if r.ValueDate.Valid {
		d := r.ValueDate.Time.Format("2006-01-02")
		fv.ValueDate = &d
	}
	if r.ValueDatetime.Valid {
		fv.ValueDatetime = &r.ValueDatetime.Time
	}
	if r.ValueJson.Valid {
		fv.ValueJSON = r.ValueJson.RawMessage
	}
	if r.EnumDictionaryID.Valid {
		fv.EnumDictionaryID = &r.EnumDictionaryID.UUID
	}
	if r.EnumVersion.Valid {
		fv.EnumVersion = &r.EnumVersion.Int32
	}
	return fv
}

func mapFieldValues(rows []queries.TaskFieldValue) []FieldValueRow {
	out := make([]FieldValueRow, len(rows))
	for i, r := range rows {
		out[i] = mapFieldValue(r)
	}
	return out
}

// =========================================================
// Tasks — Phase 4: list with search / filter / sort / grouping
// =========================================================

const (
	defaultPageSize = 20
	maxPageSize     = 100
)

// sortColumn maps the public sort_by value to a safe SQL column expression.
// Values not in this map are assumed to be UUIDs for numeric custom fields.
var systemSortColumns = map[string]string{
	"id":         "t.id",
	"title":      "t.title",
	"status":     "ts.sort_order",
	"created_at": "t.created_at",
	"updated_at": "t.updated_at",
}

// FieldFilter targets a single custom field definition and carries exactly one
// kind of value condition (user IDs, enum codes, or a date range).
type FieldFilter struct {
	FieldDefinitionID uuid.UUID
	UserIDs           []uuid.UUID // for user / users fields
	EnumCodes         []string    // for enum / multi_enum fields
	DateFrom          *string     // inclusive lower bound (YYYY-MM-DD)
	DateTo            *string     // inclusive upper bound (YYYY-MM-DD)
}

// ListTasksParams carries all inputs for the task list endpoint.
type ListTasksParams struct {
	Page     int // 1-based; default 1
	PageSize int // default 20; max 100

	Search    string      // ILIKE across public_id, title, description
	StatusIDs []uuid.UUID // filter by one or more status IDs
	Prefixes  []string    // filter by template_snapshot_prefix

	FieldFilters []FieldFilter

	SortBy   string // "id","title","status","created_at","updated_at", or UUID of numeric field
	SortDesc bool
}

// TaskGroup is one status bucket in the grouped response.
type TaskGroup struct {
	Status   StatusRow `json:"status"`
	Tasks    []TaskRow `json:"tasks"`
	Total    int       `json:"total"` // total matching tasks in this status
	Page     int       `json:"page"`
	PageSize int       `json:"page_size"`
}

// ListTasksResponse is the always-grouped task list response.
type ListTasksResponse struct {
	Groups     []TaskGroup `json:"groups"`
	GrandTotal int         `json:"grand_total"`
}

// ListTasks returns tasks grouped by status with optional search, filters,
// sorting and per-group pagination.
//
// Implementation uses two queries total regardless of status count:
//  1. Fetch all statuses (ordered by sort_order).
//  2. Fetch all matching tasks with COUNT(*) OVER (PARTITION BY t.status_id)
//     as a window function so per-status totals come for free; per-group
//     pagination is then applied in Go.
//
// Dynamic WHERE/ORDER BY is hand-written because sqlc cannot express variable
// filter predicates or sort columns. Every user-supplied value goes through
// a $N parameter; the only interpolated strings are validated constants
// (sort column names from systemSortColumns) or UUID values that have already
// been parsed by uuid.Parse.
func (s *Service) ListTasks(ctx context.Context, p ListTasksParams) (ListTasksResponse, error) {
	p = normalizeListParams(p)

	// 1. All statuses ordered by sort_order (includes deleted).
	statusRows, err := s.q.TaskStatusList(ctx, true)
	if err != nil {
		return ListTasksResponse{}, fmt.Errorf("tasks: list statuses for grouping: %w", err)
	}

	// Index statuses by ID for O(1) lookup during group assembly.
	statusByID := make(map[uuid.UUID]StatusRow, len(statusRows))
	for _, sr := range statusRows {
		statusByID[sr.ID] = mapStatus(sr)
	}

	// 2. Single query: all matching tasks + per-status count via window function.
	q, args := buildTaskQuery(p)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return ListTasksResponse{}, fmt.Errorf("tasks: list tasks: %w", err)
	}

	// rawGroup accumulates all rows for one status before pagination is applied.
	type rawGroup struct {
		total int
		tasks []TaskRow
	}
	byStatus := make(map[uuid.UUID]*rawGroup)

	defer rows.Close()
	for rows.Next() {
		var statusTotal int
		t, err := scanOneTaskWithTotal(rows, &statusTotal)
		if err != nil {
			return ListTasksResponse{}, fmt.Errorf("tasks: scan task row: %w", err)
		}
		g := byStatus[t.StatusID]
		if g == nil {
			g = &rawGroup{total: statusTotal}
			byStatus[t.StatusID] = g
		}
		g.tasks = append(g.tasks, t)
	}
	if err := rows.Err(); err != nil {
		return ListTasksResponse{}, fmt.Errorf("tasks: iterate task rows: %w", err)
	}

	// 3. Assemble groups in status sort_order; apply per-group pagination in Go.
	offset := (p.Page - 1) * p.PageSize
	groups := make([]TaskGroup, 0, len(statusRows))
	grandTotal := 0

	for _, sr := range statusRows {
		st := statusByID[sr.ID]
		g := byStatus[sr.ID]

		// Always show active statuses; skip deleted ones with no matching tasks.
		if sr.DeletedAt.Valid && g == nil {
			continue
		}

		total := 0
		var page []TaskRow
		if g != nil {
			total = g.total
			grandTotal += total
			end := offset + p.PageSize
			if offset < len(g.tasks) {
				if end > len(g.tasks) {
					end = len(g.tasks)
				}
				page = g.tasks[offset:end]
			}
		}
		if page == nil {
			page = []TaskRow{}
		}

		groups = append(groups, TaskGroup{
			Status:   st,
			Tasks:    page,
			Total:    total,
			Page:     p.Page,
			PageSize: p.PageSize,
		})
	}

	return ListTasksResponse{Groups: groups, GrandTotal: grandTotal}, nil
}

// =========================================================
// ListTasks helpers
// =========================================================

func normalizeListParams(p ListTasksParams) ListTasksParams {
	if p.Page < 1 {
		p.Page = 1
	}
	switch {
	case p.PageSize < 1:
		p.PageSize = defaultPageSize
	case p.PageSize > maxPageSize:
		p.PageSize = maxPageSize
	}
	return p
}

// buildTaskQuery returns the full SELECT SQL and its bound args.
//
// The SELECT list is taskSelectColumns followed by the window-function column:
//
//	COUNT(*) OVER (PARTITION BY t.status_id) AS status_total
//
// Callers must scan taskSelectColumns first, then status_total.
func buildTaskQuery(p ListTasksParams) (string, []any) {
	args := &argList{}

	where := buildWhereClause(p, args)
	join, sortCol := buildSortExpr(p.SortBy, p.SortDesc, args)

	sql := fmt.Sprintf(
		`SELECT %s, COUNT(*) OVER (PARTITION BY t.status_id) AS status_total`+
			` FROM task t`+
			` JOIN task_status ts ON ts.id = t.status_id%s`+
			` %s`+
			` ORDER BY %s`,
		taskSelectColumns, join, where, sortCol,
	)
	return sql, args.values
}

// taskSelectColumns lists t.* columns in scan order — must stay in sync with
// scanOneTask's Scan call.
const taskSelectColumns = `t.id, t.public_id, t.template_id, t.template_snapshot_prefix,` +
	` t.sequence_number, t.title, t.description, t.status_id, t.parent_task_id,` +
	` t.created_by, t.updated_by, t.created_at, t.updated_at`

// buildWhereClause constructs the WHERE fragment, appending bound values to args.
func buildWhereClause(p ListTasksParams, args *argList) string {
	clauses := []string{"1=1"}

	if p.Search != "" {
		ph := args.add("%" + p.Search + "%")
		clauses = append(clauses,
			fmt.Sprintf(`(t.public_id ILIKE %s OR t.title ILIKE %s OR t.description ILIKE %s)`, ph, ph, ph),
		)
	}

	if len(p.StatusIDs) > 0 {
		ph := args.add(uuidSliceToStrings(p.StatusIDs))
		clauses = append(clauses, fmt.Sprintf(`t.status_id = ANY(%s::uuid[])`, ph))
	}

	if len(p.Prefixes) > 0 {
		ph := args.add(p.Prefixes)
		clauses = append(clauses, fmt.Sprintf(`t.template_snapshot_prefix = ANY(%s::text[])`, ph))
	}

	for _, ff := range p.FieldFilters {
		if sub := buildFieldFilterSubquery(ff, args); sub != "" {
			clauses = append(clauses, fmt.Sprintf(`EXISTS (%s)`, sub))
		}
	}

	return "WHERE " + strings.Join(clauses, " AND ")
}

// buildFieldFilterSubquery returns a correlated EXISTS sub-select for one
// FieldFilter, or "" if the filter carries no usable condition.
func buildFieldFilterSubquery(ff FieldFilter, args *argList) string {
	var conds []string

	fph := args.add(ff.FieldDefinitionID)
	base := fmt.Sprintf(
		`SELECT 1 FROM task_field_value tfv WHERE tfv.task_id = t.id AND tfv.field_definition_id = %s`,
		fph,
	)

	if len(ff.UserIDs) > 0 {
		// user field:  value_user_id in the list.
		// users field: value_json is a JSON array of UUID strings; ?| checks
		//              whether any of the text keys exist as top-level elements.
		ph := args.add(uuidSliceToStrings(ff.UserIDs))
		conds = append(conds,
			fmt.Sprintf(`(tfv.value_user_id = ANY(%s::uuid[]) OR tfv.value_json ?| %s::text[])`, ph, ph),
		)
	}

	if len(ff.EnumCodes) > 0 {
		// enum:       stored in value_text.
		// multi_enum: stored as a JSON array of code strings in value_json.
		ph := args.add(ff.EnumCodes)
		conds = append(conds,
			fmt.Sprintf(`(tfv.value_text = ANY(%s::text[]) OR tfv.value_json ?| %s::text[])`, ph, ph),
		)
	}

	if ff.DateFrom != nil {
		ph := args.add(*ff.DateFrom)
		conds = append(conds,
			fmt.Sprintf(`(tfv.value_date >= %s::date OR tfv.value_datetime >= %s::timestamptz)`, ph, ph),
		)
	}

	if ff.DateTo != nil {
		ph := args.add(*ff.DateTo)
		conds = append(conds,
			fmt.Sprintf(`(tfv.value_date <= %s::date OR tfv.value_datetime <= %s::timestamptz)`, ph, ph),
		)
	}

	if len(conds) == 0 {
		return ""
	}
	return base + " AND (" + strings.Join(conds, " AND ") + ")"
}

// buildSortExpr returns the optional LEFT JOIN clause and the ORDER BY expression.
//
// When sortBy is a field-definition UUID, the UUID is passed as a bound
// parameter ($N) in the JOIN condition — never interpolated into the SQL string.
func buildSortExpr(sortBy string, desc bool, args *argList) (join, orderBy string) {
	dir := "ASC"
	if desc {
		dir = "DESC"
	}

	if col, ok := systemSortColumns[sortBy]; ok {
		return "", col + " " + dir + " NULLS LAST"
	}

	if sortBy != "" {
		if _, err := uuid.Parse(sortBy); err == nil {
			ph := args.add(sortBy) // UUID as bound parameter — no interpolation
			join = fmt.Sprintf(
				` LEFT JOIN task_field_value tfv_sort`+
					` ON tfv_sort.task_id = t.id AND tfv_sort.field_definition_id = %s`,
				ph,
			)
			return join, "tfv_sort.value_number " + dir + " NULLS LAST, t.created_at ASC"
		}
	}

	return "", "t.created_at ASC"
}

// argList is a small helper that accumulates bound values and assigns
// sequential $N placeholders, keeping buildWhereClause and its callees free
// of manual index arithmetic.
type argList struct {
	values []any
}

func (a *argList) add(v any) string {
	a.values = append(a.values, v)
	return fmt.Sprintf("$%d", len(a.values))
}

// uuidSliceToStrings converts []uuid.UUID to []string for pgx ANY() parameters.
func uuidSliceToStrings(ids []uuid.UUID) []string {
	s := make([]string, len(ids))
	for i, id := range ids {
		s[i] = id.String()
	}
	return s
}

// =========================================================
// Users (public, non-admin)
// =========================================================

// UserRow is the public view of a user returned to all authenticated users.
type UserRow struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	AvatarURL   string `json:"avatar_url"`
}

func (s *Service) ListUsers(ctx context.Context) ([]UserRow, error) {
	rows, err := s.q.ListActiveUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("tasks: list users: %w", err)
	}
	out := make([]UserRow, len(rows))
	for i, r := range rows {
		out[i] = UserRow{
			ID:          r.ID.String(),
			DisplayName: r.DisplayName,
			Email:       r.Email,
			AvatarURL:   r.AvatarUrl,
		}
	}
	return out, nil
}

// =========================================================
// Attachments (Phase 6)
// =========================================================

// UploadAttachment stores a file in object storage and records its metadata in
// the database. The service verifies that the referenced task exists before
// storing anything so partial uploads are avoided.
// UploadAttachment stores a file in object storage and records its metadata in
// the database. counter must be non-nil when p.Size == -1; the actual byte
// count is read from counter after streaming to detect over-limit uploads.
func (s *Service) UploadAttachment(ctx context.Context, p UploadAttachmentParams, maxSizeMB int, counter ByteCounter) (*AttachmentRow, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(p.FileName) == "" {
		return nil, fmt.Errorf("%w: file_name is required", ErrBadRequest)
	}
	maxBytes := int64(maxSizeMB) * 1024 * 1024

	// When size is known upfront (e.g. tests passing a real value) do an early
	// rejection before touching storage.
	if p.Size >= 0 && p.Size > maxBytes {
		return nil, fmt.Errorf("%w: file exceeds maximum allowed size of %d MB", ErrBadRequest, maxSizeMB)
	}

	// Verify task exists.
	if _, err := s.q.TaskGet(ctx, p.TaskID); err != nil {
		return nil, mapNotFound(err, "task")
	}

	// Allocate the attachment ID before uploading so we can use it in the
	// storage key, making the key fully deterministic.
	attachID := uuid.New()

	// Sanitise the file name for use in the storage key (keep the original
	// display name in the DB; only the key needs to be safe for object stores).
	safeFileName := sanitiseFileName(p.FileName)
	storageKey := fmt.Sprintf("tasks/%s/%s/%s", p.TaskID, attachID, safeFileName)

	if err := store.PutObject(ctx, storageKey, p.Body, p.Size, p.MimeType); err != nil {
		return nil, fmt.Errorf("tasks: upload attachment: %w", err)
	}

	// When streaming (Size == -1), verify the actual byte count now that
	// PutObject has drained the reader.
	actualSize := p.Size
	if counter != nil {
		actualSize = counter.BytesRead()
	}
	if actualSize > maxBytes {
		// Over the limit: delete the orphaned object and reject.
		s.deleteObjectBestEffort(ctx, store, storageKey)
		return nil, fmt.Errorf("%w: file exceeds maximum allowed size of %d MB", ErrBadRequest, maxSizeMB)
	}

	row, err := s.q.TaskAttachmentCreate(ctx, queries.TaskAttachmentCreateParams{
		ID:         attachID,
		TaskID:     p.TaskID,
		FileName:   p.FileName,
		FileSize:   actualSize,
		MimeType:   p.MimeType,
		StorageKey: storageKey,
		UploadedBy: p.ActorID,
	})
	if err != nil {
		// Best-effort cleanup of the orphaned object.
		s.deleteObjectBestEffort(ctx, store, storageKey)
		return nil, fmt.Errorf("tasks: create attachment record: %w", err)
	}

	out := mapAttachment(row)
	return &out, nil
}

// ListAttachments returns all attachments for a task in upload order.
func (s *Service) ListAttachments(ctx context.Context, taskID uuid.UUID) ([]AttachmentRow, error) {
	if _, err := s.q.TaskGet(ctx, taskID); err != nil {
		return nil, mapNotFound(err, "task")
	}
	rows, err := s.q.TaskAttachmentList(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("tasks: list attachments: %w", err)
	}
	out := make([]AttachmentRow, len(rows))
	for i, r := range rows {
		out[i] = mapAttachment(r)
	}
	return out, nil
}

// DownloadAttachment retrieves the attachment metadata and opens an object
// stream. The caller is responsible for closing the returned ReadCloser.
func (s *Service) DownloadAttachment(ctx context.Context, taskID, attachmentID uuid.UUID) (io.ReadCloser, int64, string, string, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, 0, "", "", err
	}

	row, err := s.q.TaskAttachmentGet(ctx, attachmentID)
	if err != nil {
		return nil, 0, "", "", mapNotFound(err, "attachment")
	}
	if row.TaskID != taskID {
		return nil, 0, "", "", fmt.Errorf("%w: attachment", ErrNotFound)
	}

	body, size, mimeType, err := store.GetObject(ctx, row.StorageKey)
	if err != nil {
		return nil, 0, "", "", fmt.Errorf("tasks: download attachment: %w", err)
	}
	return body, size, mimeType, row.FileName, nil
}

// DeleteAttachment removes an attachment from the database and then from object
// storage.
//
// Ordering rationale: the DB row is deleted first. If the subsequent storage
// delete fails the object becomes an orphan (storage garbage), but the record
// is gone so users never see a dangling reference and downloads no longer
// return a 500. A DB failure after successful storage deletion would leave a
// record that points to a missing object — far worse, because every download
// attempt would then surface a storage error. The storage orphan path is
// self-contained and can be cleaned up by a background sweep if needed.
func (s *Service) DeleteAttachment(ctx context.Context, taskID, attachmentID uuid.UUID) error {
	store, err := s.requireStore()
	if err != nil {
		return err
	}

	row, err := s.q.TaskAttachmentGet(ctx, attachmentID)
	if err != nil {
		return mapNotFound(err, "attachment")
	}
	if row.TaskID != taskID {
		return fmt.Errorf("%w: attachment", ErrNotFound)
	}

	// Delete the DB record first.
	if _, err = s.q.TaskAttachmentDelete(ctx, queries.TaskAttachmentDeleteParams{
		ID:     attachmentID,
		TaskID: taskID,
	}); err != nil {
		return fmt.Errorf("tasks: delete attachment record: %w", err)
	}

	// Best-effort storage deletion. An orphaned object is a storage concern,
	// not a correctness concern for the API consumer.
	s.deleteObjectBestEffort(ctx, store, row.StorageKey)
	return nil
}

// =========================================================
// Comments (Phase 6)
// =========================================================

// UploadCommentAttachment stores a staged attachment for a task comment.
func (s *Service) UploadCommentAttachment(
	ctx context.Context,
	p UploadCommentAttachmentParams,
	maxSizeMB int,
) (*CommentAttachmentRow, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(p.FileName) == "" {
		return nil, fmt.Errorf("%w: file_name is required", ErrBadRequest)
	}
	if p.Size < 0 {
		return nil, fmt.Errorf("%w: file size must be provided", ErrBadRequest)
	}
	if p.MimeType == "" {
		p.MimeType = "application/octet-stream"
	}

	maxBytes := int64(maxSizeMB) * 1024 * 1024
	if p.Size > maxBytes {
		return nil, fmt.Errorf("%w: file exceeds maximum allowed size of %d MB", ErrBadRequest, maxSizeMB)
	}

	if _, err := s.q.TaskGet(ctx, p.TaskID); err != nil {
		return nil, mapNotFound(err, "task")
	}

	// Read the request body with a hard cap and use the actual byte count for
	// storage and persistence. This avoids trusting client-declared multipart
	// sizes and prevents silent truncation on mismatched size claims.
	payload, err := io.ReadAll(io.LimitReader(p.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("tasks: read comment attachment payload: %w", err)
	}
	actualSize := int64(len(payload))
	if actualSize > maxBytes {
		return nil, fmt.Errorf("%w: file exceeds maximum allowed size of %d MB", ErrBadRequest, maxSizeMB)
	}
	if p.Size >= 0 && p.Size != actualSize {
		return nil, fmt.Errorf("%w: uploaded file size does not match multipart metadata", ErrBadRequest)
	}

	attachmentID := uuid.New()
	safeFileName := sanitiseFileName(p.FileName)
	storageKey := fmt.Sprintf("tasks/%s/comments/%s/%s", p.TaskID, attachmentID, safeFileName)

	if err := store.PutObject(ctx, storageKey, bytes.NewReader(payload), actualSize, p.MimeType); err != nil {
		return nil, fmt.Errorf("tasks: upload comment attachment: %w", err)
	}

	row, err := s.q.TaskCommentAttachmentCreate(ctx, queries.TaskCommentAttachmentCreateParams{
		ID:         attachmentID,
		TaskID:     p.TaskID,
		CommentID:  uuid.NullUUID{},
		FileName:   p.FileName,
		FileSize:   actualSize,
		MimeType:   p.MimeType,
		StorageKey: storageKey,
		UploadedBy: p.ActorID,
	})
	if err != nil {
		s.deleteObjectBestEffort(ctx, store, storageKey)
		return nil, fmt.Errorf("tasks: create comment attachment record: %w", err)
	}
	out := mapTaskCommentAttachment(row)
	return &out, nil
}

// DeleteStagedCommentAttachment deletes a staged (not yet linked) comment attachment.
// Only the original uploader may delete it.
func (s *Service) DeleteStagedCommentAttachment(ctx context.Context, taskID, actorID, attachmentID uuid.UUID) error {
	store, err := s.requireStore()
	if err != nil {
		return err
	}

	row, err := s.q.TaskCommentAttachmentGet(ctx, attachmentID)
	if err != nil {
		return mapNotFound(err, "attachment")
	}
	if row.TaskID != taskID {
		return fmt.Errorf("%w: attachment", ErrNotFound)
	}
	if row.UploadedBy != actorID {
		return fmt.Errorf("%w: attachment does not belong to user", ErrForbidden)
	}
	if row.CommentID.Valid {
		return fmt.Errorf("%w: attachment already linked to a comment", ErrBadRequest)
	}

	if _, err := s.q.TaskCommentAttachmentDeleteStaged(ctx, queries.TaskCommentAttachmentDeleteStagedParams{
		ID:     attachmentID,
		TaskID: taskID,
	}); err != nil {
		return mapNotFound(err, "attachment")
	}
	// Best-effort storage delete: the DB row is already removed, so a storage
	// failure leaves an orphan object but no broken API references.
	s.deleteObjectBestEffort(ctx, store, row.StorageKey)
	return nil
}

// DownloadCommentAttachment opens a linked comment attachment stream.
func (s *Service) DownloadCommentAttachment(
	ctx context.Context,
	taskID, commentID, attachmentID uuid.UUID,
) (io.ReadCloser, int64, string, string, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, 0, "", "", err
	}

	row, err := s.q.TaskCommentAttachmentGet(ctx, attachmentID)
	if err != nil {
		return nil, 0, "", "", mapNotFound(err, "attachment")
	}
	if row.TaskID != taskID {
		return nil, 0, "", "", fmt.Errorf("%w: attachment", ErrNotFound)
	}
	if !row.CommentID.Valid || row.CommentID.UUID != commentID {
		return nil, 0, "", "", fmt.Errorf("%w: attachment", ErrNotFound)
	}

	body, size, mimeType, err := store.GetObject(ctx, row.StorageKey)
	if err != nil {
		return nil, 0, "", "", fmt.Errorf("tasks: download comment attachment: %w", err)
	}
	if mimeType == "" {
		mimeType = row.MimeType
	}
	return body, size, mimeType, row.FileName, nil
}

// CreateComment adds a new comment to a task. Comment bodies cannot be edited
// after creation (enforced by a DB trigger).
func (s *Service) CreateComment(ctx context.Context, taskID, authorID uuid.UUID, body string, attachmentIDs ...uuid.UUID) (*CommentRow, error) {
	body = strings.TrimSpace(body)
	attachmentIDs = uniqueUUIDs(attachmentIDs)
	if body == "" && len(attachmentIDs) == 0 {
		return nil, fmt.Errorf("%w: comment body or attachments are required", ErrBadRequest)
	}
	if len(attachmentIDs) > maxCommentAttachments {
		return nil, fmt.Errorf("%w: max %d attachments allowed", ErrBadRequest, maxCommentAttachments)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("tasks: begin create comment tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Lock the parent task row so delete cannot race between validation and
	// INSERT into task_comment.
	var marker int
	if err := tx.QueryRow(ctx, `SELECT 1 FROM task WHERE id = $1 FOR KEY SHARE`, taskID).Scan(&marker); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: task", ErrNotFound)
		}
		return nil, fmt.Errorf("tasks: verify task in create comment tx: %w", err)
	}

	attachments := make([]CommentAttachmentRow, 0, len(attachmentIDs))
	if len(attachmentIDs) > 0 {
		rows, err := tx.Query(ctx, `
			SELECT id, task_id, comment_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at
			  FROM task_comment_attachment
			 WHERE id = ANY($1::uuid[])
			 FOR UPDATE`,
			attachmentIDs,
		)
		if err != nil {
			return nil, fmt.Errorf("tasks: lock comment attachments: %w", err)
		}
		attachmentsByID := make(map[uuid.UUID]CommentAttachmentRow, len(attachmentIDs))
		for rows.Next() {
			item, scanErr := scanTaskCommentAttachment(rows)
			if scanErr != nil {
				rows.Close()
				return nil, fmt.Errorf("tasks: scan comment attachment: %w", scanErr)
			}
			attachmentsByID[item.ID] = item
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("tasks: iterate comment attachment rows: %w", err)
		}
		if len(attachmentsByID) != len(attachmentIDs) {
			return nil, fmt.Errorf("%w: invalid attachment_ids", ErrBadRequest)
		}

		for _, attachmentID := range attachmentIDs {
			item := attachmentsByID[attachmentID]
			if item.TaskID != taskID {
				return nil, fmt.Errorf("%w: attachment does not belong to task", ErrBadRequest)
			}
			if item.UploadedBy != authorID {
				return nil, fmt.Errorf("%w: attachment does not belong to user", ErrForbidden)
			}
			if item.CommentID != nil {
				return nil, fmt.Errorf("%w: attachment already linked to a comment", ErrBadRequest)
			}
			attachments = append(attachments, item)
		}
	}

	var out CommentRow
	if err := tx.QueryRow(ctx, `
		INSERT INTO task_comment (task_id, author_id, body)
		VALUES ($1, $2, $3)
		RETURNING id, task_id, author_id, body, created_at, updated_at`,
		taskID,
		authorID,
		body,
	).Scan(
		&out.ID,
		&out.TaskID,
		&out.AuthorID,
		&out.Body,
		&out.CreatedAt,
		&out.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("tasks: create comment in tx: %w", err)
	}

	if len(attachmentIDs) > 0 {
		tag, err := tx.Exec(ctx, `
			UPDATE task_comment_attachment
			   SET comment_id = $1
			 WHERE id = ANY($2::uuid[])
			   AND comment_id IS NULL`,
			out.ID,
			attachmentIDs,
		)
		if err != nil {
			return nil, fmt.Errorf("tasks: link comment attachments: %w", err)
		}
		if tag.RowsAffected() != int64(len(attachmentIDs)) {
			return nil, fmt.Errorf("%w: failed to link all attachments", ErrBadRequest)
		}

		out.Attachments = make([]CommentAttachmentRow, 0, len(attachments))
		for _, attachment := range attachments {
			commentID := out.ID
			attachment.CommentID = &commentID
			out.Attachments = append(out.Attachments, attachment)
		}
	} else {
		out.Attachments = []CommentAttachmentRow{}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("tasks: commit create comment tx: %w", err)
	}
	return &out, nil
}

func (s *Service) requireStore() (Storage, error) {
	if s.store == nil {
		return nil, fmt.Errorf("tasks: attachment storage unavailable")
	}
	return s.store, nil
}

func (s *Service) deleteObjectBestEffort(ctx context.Context, store Storage, storageKey string) {
	if store == nil {
		return
	}
	if err := store.DeleteObject(ctx, storageKey); err != nil {
		// Best-effort only: cleanup failure can leave an orphaned object, but
		// should not fail the higher-level operation after DB state is finalized.
		_ = err
	}
}

// ListComments returns all comments for a task in chronological order.
func (s *Service) ListComments(ctx context.Context, taskID uuid.UUID) ([]CommentRow, error) {
	if _, err := s.q.TaskGet(ctx, taskID); err != nil {
		return nil, mapNotFound(err, "task")
	}
	rows, err := s.q.TaskCommentListWithAttachments(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("tasks: list comments: %w", err)
	}

	out := make([]CommentRow, 0, len(rows))
	for _, row := range rows {
		item := CommentRow{
			ID:        row.ID,
			TaskID:    row.TaskID,
			AuthorID:  row.AuthorID,
			Body:      row.Body,
			CreatedAt: row.CreatedAt,
			UpdatedAt: row.UpdatedAt,
		}
		attachmentsJSON, err := normalizeJSONValue(row.Attachments)
		if err != nil {
			return nil, fmt.Errorf("tasks: normalize comment attachments: %w", err)
		}
		if len(attachmentsJSON) > 0 {
			if err := json.Unmarshal(attachmentsJSON, &item.Attachments); err != nil {
				return nil, fmt.Errorf("tasks: decode comment attachments: %w", err)
			}
		}
		if item.Attachments == nil {
			item.Attachments = []CommentAttachmentRow{}
		}
		out = append(out, item)
	}
	return out, nil
}

// uniqueUUIDs removes duplicate UUIDs while preserving the first-seen order.
func uniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func normalizeJSONValue(v any) ([]byte, error) {
	switch value := v.(type) {
	case nil:
		return nil, nil
	case []byte:
		return value, nil
	case string:
		return []byte(value), nil
	case json.RawMessage:
		return value, nil
	default:
		b, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		return b, nil
	}
}

type taskCommentAttachmentScanner interface {
	Scan(dest ...any) error
}

func scanTaskCommentAttachment(scanner taskCommentAttachmentScanner) (CommentAttachmentRow, error) {
	var item CommentAttachmentRow
	var commentID uuid.NullUUID
	if err := scanner.Scan(
		&item.ID,
		&item.TaskID,
		&commentID,
		&item.FileName,
		&item.FileSize,
		&item.MimeType,
		&item.StorageKey,
		&item.UploadedBy,
		&item.CreatedAt,
	); err != nil {
		return CommentAttachmentRow{}, err
	}
	if commentID.Valid {
		commentUUID := commentID.UUID
		item.CommentID = &commentUUID
	}
	return item, nil
}

// =========================================================
// Phase 6 mapper helpers
// =========================================================

func mapAttachment(r queries.TaskAttachment) AttachmentRow {
	return AttachmentRow{
		ID:         r.ID,
		TaskID:     r.TaskID,
		FileName:   r.FileName,
		FileSize:   r.FileSize,
		MimeType:   r.MimeType,
		StorageKey: r.StorageKey,
		UploadedBy: r.UploadedBy,
		CreatedAt:  r.CreatedAt,
	}
}

func mapComment(r queries.TaskComment) CommentRow {
	return CommentRow{
		ID:        r.ID,
		TaskID:    r.TaskID,
		AuthorID:  r.AuthorID,
		Body:      r.Body,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

func mapTaskCommentAttachment(r queries.TaskCommentAttachment) CommentAttachmentRow {
	var commentID *uuid.UUID
	if r.CommentID.Valid {
		id := r.CommentID.UUID
		commentID = &id
	}
	return CommentAttachmentRow{
		ID:         r.ID,
		TaskID:     r.TaskID,
		CommentID:  commentID,
		FileName:   r.FileName,
		FileSize:   r.FileSize,
		MimeType:   r.MimeType,
		StorageKey: r.StorageKey,
		UploadedBy: r.UploadedBy,
		CreatedAt:  r.CreatedAt,
	}
}

// sanitiseFileName strips path separators and other problematic characters
// so that the file name is safe to embed in an object storage key.
func sanitiseFileName(name string) string {
	// Replace any forward/backslash with underscore.
	name = strings.NewReplacer("/", "_", "\\", "_").Replace(name)
	// Remove characters that are problematic in URLs / object keys.
	var b strings.Builder
	for _, r := range name {
		if r <= 0x1f || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	result := b.String()
	if result == "" {
		return "file"
	}
	return result
}

// ---- Additional null helpers ----

// nullableString converts *string to sql.NullString.
func nullableString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

func nullInt32Ptr(v *int32) sql.NullInt32 {
	if v == nil {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: *v, Valid: true}
}
