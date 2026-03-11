package events

import (
	"fmt"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
	packetspb "msgnr/internal/gen/proto"
)

var payloadUnmarshalOptions = protojson.UnmarshalOptions{
	DiscardUnknown: true,
}

func buildServerEventFromStored(
	eventTypeText string,
	eventID string,
	channelID string,
	occurredAt time.Time,
	payloadJSON []byte,
) (*packetspb.ServerEvent, error) {
	evtType, err := DBTextToProtoEventType(eventTypeText)
	if err != nil {
		return nil, err
	}

	evt := &packetspb.ServerEvent{
		EventId:        eventID,
		EventType:      evtType,
		ConversationId: channelID,
		OccurredAt:     timestamppb.New(occurredAt),
	}

	switch evtType {
	case packetspb.EventType_EVENT_TYPE_CONVERSATION_UPSERTED:
		msg := &packetspb.ConversationUpsertedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode conversation_upserted payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_ConversationUpserted{ConversationUpserted: msg}
	case packetspb.EventType_EVENT_TYPE_CONVERSATION_REMOVED:
		msg := &packetspb.ConversationRemovedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode conversation_removed payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_ConversationRemoved{ConversationRemoved: msg}
	case packetspb.EventType_EVENT_TYPE_MEMBERSHIP_CHANGED:
		msg := &packetspb.MembershipChangedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode membership_changed payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_MembershipChanged{MembershipChanged: msg}
	case packetspb.EventType_EVENT_TYPE_MESSAGE_CREATED:
		msg := &packetspb.MessageEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode message_created payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_MessageCreated{MessageCreated: msg}
	case packetspb.EventType_EVENT_TYPE_READ_COUNTER_UPDATED:
		msg := &packetspb.ReadCounterUpdatedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode read_counter_updated payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_ReadCounterUpdated{ReadCounterUpdated: msg}
	case packetspb.EventType_EVENT_TYPE_NOTIFICATION_ADDED:
		msg := &packetspb.NotificationAddedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode notification_added payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_NotificationAdded{NotificationAdded: msg}
	case packetspb.EventType_EVENT_TYPE_NOTIFICATION_RESOLVED:
		msg := &packetspb.NotificationResolvedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode notification_resolved payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_NotificationResolved{NotificationResolved: msg}
	case packetspb.EventType_EVENT_TYPE_CALL_INVITE_CREATED:
		msg := &packetspb.CallInviteCreatedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode call_invite_created payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_CallInviteCreated{CallInviteCreated: msg}
	case packetspb.EventType_EVENT_TYPE_CALL_INVITE_CANCELLED:
		msg := &packetspb.CallInviteCancelledEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode call_invite_cancelled payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_CallInviteCancelled{CallInviteCancelled: msg}
	case packetspb.EventType_EVENT_TYPE_CALL_STATE_CHANGED:
		msg := &packetspb.CallStateChangedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode call_state_changed payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_CallStateChanged{CallStateChanged: msg}
	case packetspb.EventType_EVENT_TYPE_THREAD_SUMMARY_UPDATED:
		msg := &packetspb.ThreadSummaryUpdatedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode thread_summary_updated payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_ThreadSummaryUpdated{ThreadSummaryUpdated: msg}
	case packetspb.EventType_EVENT_TYPE_REACTION_UPDATED:
		msg := &packetspb.ReactionUpdatedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode reaction_updated payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_ReactionUpdated{ReactionUpdated: msg}
	case packetspb.EventType_EVENT_TYPE_USER_IDENTITY_UPDATED:
		msg := &packetspb.UserIdentityUpdatedEvent{}
		if err := payloadUnmarshalOptions.Unmarshal(payloadJSON, msg); err != nil {
			return nil, fmt.Errorf("decode user_identity_updated payload: %w", err)
		}
		evt.Payload = &packetspb.ServerEvent_UserIdentityUpdated{UserIdentityUpdated: msg}
	default:
		return nil, fmt.Errorf("unsupported event_type %v", evtType)
	}

	if err := ValidateEventTypePayload(eventTypeText, evt); err != nil {
		return nil, err
	}
	return evt, nil
}
