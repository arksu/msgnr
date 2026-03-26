package tasks

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
