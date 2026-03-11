package events

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	packetspb "msgnr/internal/gen/proto"
)

func TestBuildServerEventFromStored_DecodesMessageCreated(t *testing.T) {
	occurredAt := time.Unix(1700000000, 0).UTC()
	payload := []byte(`{
		"conversationId":"c1",
		"messageId":"m1",
		"senderId":"u1",
		"body":"hello",
		"channelSeq":"12"
	}`)

	evt, err := buildServerEventFromStored(
		"message_created",
		"11111111-1111-1111-1111-111111111111",
		"22222222-2222-2222-2222-222222222222",
		occurredAt,
		payload,
	)
	require.NoError(t, err)
	require.NotNil(t, evt)
	assert.Equal(t, packetspb.EventType_EVENT_TYPE_MESSAGE_CREATED, evt.GetEventType())
	require.NotNil(t, evt.GetMessageCreated())
	assert.Equal(t, "m1", evt.GetMessageCreated().GetMessageId())
	assert.Equal(t, "22222222-2222-2222-2222-222222222222", evt.GetConversationId())
}

func TestBuildServerEventFromStored_RejectsTypePayloadMismatch(t *testing.T) {
	_, err := buildServerEventFromStored(
		"message_created",
		"11111111-1111-1111-1111-111111111111",
		"",
		time.Now().UTC(),
		[]byte(`{"channelSeq":"not-an-int64"}`),
	)
	require.Error(t, err)
}

func TestBuildServerEventFromStored_DecodesUserIdentityUpdated(t *testing.T) {
	occurredAt := time.Unix(1700001000, 0).UTC()
	payload := []byte(`{
		"userId":"u1",
		"displayName":"Ada",
		"avatarUrl":"/api/public/avatars/avatars/u1/a.png"
	}`)

	evt, err := buildServerEventFromStored(
		"user_identity_updated",
		"33333333-3333-3333-3333-333333333333",
		"",
		occurredAt,
		payload,
	)
	require.NoError(t, err)
	require.NotNil(t, evt)
	assert.Equal(t, packetspb.EventType_EVENT_TYPE_USER_IDENTITY_UPDATED, evt.GetEventType())
	require.NotNil(t, evt.GetUserIdentityUpdated())
	assert.Equal(t, "u1", evt.GetUserIdentityUpdated().GetUserId())
	assert.Equal(t, "Ada", evt.GetUserIdentityUpdated().GetDisplayName())
}
