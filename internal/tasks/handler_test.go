package tasks

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"msgnr/internal/auth"
)

func TestParseTaskFilterParams_IncludeSubtasks(t *testing.T) {
	t.Run("defaults to false when absent", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/tasks", nil)

		params, err := parseTaskFilterParams(req)
		require.NoError(t, err)
		assert.False(t, params.IncludeSubtasks)
	})

	t.Run("parses true when provided", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/tasks?include_subtasks=true", nil)

		params, err := parseTaskFilterParams(req)
		require.NoError(t, err)
		assert.True(t, params.IncludeSubtasks)
	})
}

func TestTaskCommentsRouter_InvalidUpdateCommentID(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodPut, "/api/tasks/task/comments/not-a-uuid", strings.NewReader(`{"body":"x"}`))
	rec := httptest.NewRecorder()

	h.taskCommentsRouter(rec, req, auth.Principal{UserID: uuid.New()}, uuid.New(), "/not-a-uuid")

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid comment id")
}

func TestTaskCommentUpdate_InvalidRequestBody(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodPut, "/api/tasks/task/comments/"+uuid.NewString(), strings.NewReader(`{`))
	rec := httptest.NewRecorder()

	h.taskCommentUpdate(rec, req, auth.Principal{UserID: uuid.New()}, uuid.New(), uuid.New())

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid request body")
}
