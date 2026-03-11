package chat

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"msgnr/internal/auth"
	"msgnr/internal/config"
)

func TestListConversationMessages_InvalidConversationID(t *testing.T) {
	h := NewHandler(nil, nil, &config.Config{ChatHistoryPageSize: 50})
	req := httptest.NewRequest("GET", "/api/messages?conversation_id=not-a-uuid", nil)
	rec := httptest.NewRecorder()

	h.listConversationMessages(rec, req, auth.Principal{})

	require.Equal(t, 400, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid conversation_id")
}

func TestListConversationMessages_InvalidBeforeChannelSeq(t *testing.T) {
	h := NewHandler(nil, nil, &config.Config{ChatHistoryPageSize: 50})
	req := httptest.NewRequest("GET", "/api/messages?conversation_id=89d8e95f-bfd1-4476-a6d9-9856c0ec7c4f&before_channel_seq=bad", nil)
	rec := httptest.NewRecorder()

	h.listConversationMessages(rec, req, auth.Principal{})

	require.Equal(t, 400, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid before_channel_seq")
}

func TestListConversationMessages_RejectsNonPositiveBeforeChannelSeq(t *testing.T) {
	h := NewHandler(nil, nil, &config.Config{ChatHistoryPageSize: 50})
	req := httptest.NewRequest("GET", "/api/messages?conversation_id=89d8e95f-bfd1-4476-a6d9-9856c0ec7c4f&before_channel_seq=0", nil)
	rec := httptest.NewRecorder()

	h.listConversationMessages(rec, req, auth.Principal{})

	require.Equal(t, 400, rec.Code)
	assert.Contains(t, rec.Body.String(), "before_channel_seq must be")
}
