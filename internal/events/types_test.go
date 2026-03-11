package events

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	packetspb "msgnr/internal/gen/proto"
)

func TestDBTextToProtoEventType_RoundTrip(t *testing.T) {
	// Every DB text value must map to a known proto value and back.
	for dbText, expected := range eventTypeToProto {
		got, err := DBTextToProtoEventType(dbText)
		require.NoError(t, err, "DBTextToProtoEventType(%q)", dbText)
		assert.Equal(t, expected, got, "forward mapping for %q", dbText)

		back, err := ProtoEventTypeToDBText(got)
		require.NoError(t, err, "ProtoEventTypeToDBText(%v)", got)
		assert.Equal(t, dbText, back, "reverse mapping for %v", got)
	}
}

func TestDBTextToProtoEventType_Unknown(t *testing.T) {
	_, err := DBTextToProtoEventType("unknown_type")
	assert.Error(t, err)
}

func TestProtoEventTypeToDBText_Unknown(t *testing.T) {
	_, err := ProtoEventTypeToDBText(packetspb.EventType_EVENT_TYPE_UNSPECIFIED)
	assert.Error(t, err)
}

func TestValidateEventTypePayload_Valid(t *testing.T) {
	cases := []struct {
		dbText string
		evt    *packetspb.ServerEvent
	}{
		{
			"conversation_upserted",
			&packetspb.ServerEvent{
				EventType: packetspb.EventType_EVENT_TYPE_CONVERSATION_UPSERTED,
				Payload: &packetspb.ServerEvent_ConversationUpserted{
					ConversationUpserted: &packetspb.ConversationUpsertedEvent{},
				},
			},
		},
		{
			"message_created",
			&packetspb.ServerEvent{
				EventType: packetspb.EventType_EVENT_TYPE_MESSAGE_CREATED,
				Payload: &packetspb.ServerEvent_MessageCreated{
					MessageCreated: &packetspb.MessageEvent{},
				},
			},
		},
		{
			"reaction_updated",
			&packetspb.ServerEvent{
				EventType: packetspb.EventType_EVENT_TYPE_REACTION_UPDATED,
				Payload: &packetspb.ServerEvent_ReactionUpdated{
					ReactionUpdated: &packetspb.ReactionUpdatedEvent{},
				},
			},
		},
		{
			"user_identity_updated",
			&packetspb.ServerEvent{
				EventType: packetspb.EventType_EVENT_TYPE_USER_IDENTITY_UPDATED,
				Payload: &packetspb.ServerEvent_UserIdentityUpdated{
					UserIdentityUpdated: &packetspb.UserIdentityUpdatedEvent{},
				},
			},
		},
	}

	for _, tc := range cases {
		err := ValidateEventTypePayload(tc.dbText, tc.evt)
		assert.NoError(t, err, "expected valid for %q", tc.dbText)
	}
}

func TestValidateEventTypePayload_MismatchedType(t *testing.T) {
	// event_type says conversation_upserted but proto says message_created.
	evt := &packetspb.ServerEvent{
		EventType: packetspb.EventType_EVENT_TYPE_MESSAGE_CREATED,
		Payload: &packetspb.ServerEvent_MessageCreated{
			MessageCreated: &packetspb.MessageEvent{},
		},
	}
	err := ValidateEventTypePayload("conversation_upserted", evt)
	assert.Error(t, err)
}

func TestValidateEventTypePayload_MissingPayload(t *testing.T) {
	// event_type matches proto enum but the oneof payload is nil.
	evt := &packetspb.ServerEvent{
		EventType: packetspb.EventType_EVENT_TYPE_CONVERSATION_UPSERTED,
		// no Payload set
	}
	err := ValidateEventTypePayload("conversation_upserted", evt)
	assert.Error(t, err)
}

func TestValidateEventTypePayload_UnknownDBText(t *testing.T) {
	evt := &packetspb.ServerEvent{}
	err := ValidateEventTypePayload("bogus_type", evt)
	assert.Error(t, err)
}
