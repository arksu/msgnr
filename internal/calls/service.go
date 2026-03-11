package calls

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	lkauth "github.com/livekit/protocol/auth"
	livekitpb "github.com/livekit/protocol/livekit"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	"msgnr/internal/config"
	"msgnr/internal/events"
	packetspb "msgnr/internal/gen/proto"
	"msgnr/internal/logger"
)

var (
	ErrNotMember         = errors.New("not a conversation member")
	ErrCallAlreadyActive = errors.New("call already active")
	ErrCallNotActive     = errors.New("call not active")
	ErrInviteNotFound    = errors.New("invite not found")
	ErrInviteNotActive   = errors.New("invite not active")
	ErrForbiddenAction   = errors.New("forbidden call action")
	ErrBadRequest        = errors.New("bad request")
)

const (
	webhookEventRoomFinished         = "room_finished"
	webhookEventParticipantJoined    = "participant_joined"
	webhookEventParticipantLeft      = "participant_left"
	webhookEventParticipantConnAbort = "participant_connection_aborted"
)

type Service struct {
	pool       *pgxpool.Pool
	eventStore *events.Store
	cfg        *config.Config
	log        *zap.Logger
}

type DirectDelivery struct {
	UserID string
	Event  *packetspb.ServerEvent
}

type CreateCallParams struct {
	ConversationID uuid.UUID
	InitiatorID    uuid.UUID
	InitiatorRole  string
	InviteeUserIDs []uuid.UUID
}

type CreateCallResult struct {
	CallID           uuid.UUID
	ConversationID   uuid.UUID
	Status           packetspb.CallStatus
	DirectDeliveries []DirectDelivery
}

type InviteCallMembersParams struct {
	ConversationID uuid.UUID
	ActorID        uuid.UUID
	ActorRole      string
	InviteeUserIDs []uuid.UUID
}

type InviteCallMembersResult struct {
	CallID           uuid.UUID
	ConversationID   uuid.UUID
	InvitedUserIDs   []uuid.UUID
	SkippedUserIDs   []uuid.UUID
	DirectDeliveries []DirectDelivery
}

type JoinCallTokenParams struct {
	ConversationID uuid.UUID
	UserID         uuid.UUID
}

type JoinCallTokenResult struct {
	LiveKitURL   string
	LiveKitToken string
	LiveKitRoom  string
}

type InviteActionParams struct {
	InviteID  uuid.UUID
	ActorID   uuid.UUID
	ActorRole string
}

type InviteActionResult struct {
	InviteID         uuid.UUID
	ResultingState   packetspb.InviteState
	Applied          bool
	DirectDeliveries []DirectDelivery
}

type ExpireInvitesResult struct {
	ExpiredCount     int
	DirectDeliveries []DirectDelivery
}

type conversationMeta struct {
	Kind       string
	Visibility string
}

type callRow struct {
	ID          uuid.UUID
	ChannelID   uuid.UUID
	LiveKitRoom string
}

type inviteRow struct {
	ID         uuid.UUID
	CallID     uuid.UUID
	ChannelID  uuid.UUID
	InviterID  uuid.UUID
	InviteeID  uuid.UUID
	State      string
	ExpiresAt  time.Time
	CallStatus string
}

type notificationRow struct {
	ID        uuid.UUID
	Type      string
	Title     string
	Body      string
	ChannelID uuid.UUID
	IsRead    bool
	CreatedAt time.Time
}

func NewService(pool *pgxpool.Pool, eventStore *events.Store, cfg *config.Config) *Service {
	log := logger.Logger
	if log == nil {
		log = zap.NewNop()
	}
	return &Service{pool: pool, eventStore: eventStore, cfg: cfg, log: log}
}

func (s *Service) CreateCall(ctx context.Context, p CreateCallParams) (CreateCallResult, error) {
	if p.ConversationID == uuid.Nil || p.InitiatorID == uuid.Nil {
		return CreateCallResult{}, ErrBadRequest
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CreateCallResult{}, fmt.Errorf("calls.CreateCall begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	meta, isMember, err := s.loadConversationMetaTx(ctx, tx, p.ConversationID, p.InitiatorID)
	if err != nil {
		return CreateCallResult{}, fmt.Errorf("calls.CreateCall load conversation: %w", err)
	}
	if !isMember {
		return CreateCallResult{}, ErrNotMember
	}

	if _, exists, err := s.findActiveCallTx(ctx, tx, p.ConversationID); err != nil {
		return CreateCallResult{}, fmt.Errorf("calls.CreateCall find active call: %w", err)
	} else if exists {
		return CreateCallResult{}, ErrCallAlreadyActive
	}

	callID := uuid.New()
	liveKitRoom := "call-" + callID.String()
	if _, err := tx.Exec(ctx, `
		INSERT INTO calls (id, channel_id, status, livekit_room, created_by, started_at)
		VALUES ($1, $2, 'active', $3, $4, now())`,
		callID,
		p.ConversationID,
		liveKitRoom,
		p.InitiatorID,
	); err != nil {
		if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23505" {
			return CreateCallResult{}, ErrCallAlreadyActive
		}
		return CreateCallResult{}, fmt.Errorf("calls.CreateCall insert call: %w", err)
	}

	if err := s.upsertParticipantTx(ctx, tx, callID, p.InitiatorID); err != nil {
		return CreateCallResult{}, err
	}

	if err := s.appendCallStateChangedTx(ctx, tx, callID, p.ConversationID, packetspb.CallStatus_CALL_STATUS_ACTIVE); err != nil {
		return CreateCallResult{}, err
	}

	invitees, err := s.resolveInviteesTx(ctx, tx, meta, p.ConversationID, p.InitiatorID, p.InviteeUserIDs)
	if err != nil {
		return CreateCallResult{}, err
	}

	directDeliveries := make([]DirectDelivery, 0, len(invitees)*3)
	for _, inviteeID := range invitees {
		rejectedDeliveries, err := s.rejectOlderActiveInvitesTx(ctx, tx, inviteeID)
		if err != nil {
			return CreateCallResult{}, err
		}
		directDeliveries = append(directDeliveries, rejectedDeliveries...)

		invite, err := s.createInviteTx(ctx, tx, callID, p.ConversationID, p.InitiatorID, inviteeID)
		if err != nil {
			return CreateCallResult{}, err
		}
		directDeliveries = append(directDeliveries, DirectDelivery{
			UserID: inviteeID.String(),
			Event:  s.buildCallInviteCreatedEvent(invite),
		})

		notification, err := s.createInviteNotificationTx(ctx, tx, p.ConversationID, p.InitiatorID, inviteeID)
		if err != nil {
			return CreateCallResult{}, err
		}
		directDeliveries = append(directDeliveries, DirectDelivery{
			UserID: inviteeID.String(),
			Event:  s.buildNotificationAddedEvent(inviteeID, notification),
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return CreateCallResult{}, fmt.Errorf("calls.CreateCall commit: %w", err)
	}

	return CreateCallResult{
		CallID:           callID,
		ConversationID:   p.ConversationID,
		Status:           packetspb.CallStatus_CALL_STATUS_ACTIVE,
		DirectDeliveries: directDeliveries,
	}, nil
}

func (s *Service) JoinCallToken(ctx context.Context, p JoinCallTokenParams) (JoinCallTokenResult, error) {
	if p.ConversationID == uuid.Nil || p.UserID == uuid.Nil {
		return JoinCallTokenResult{}, ErrBadRequest
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return JoinCallTokenResult{}, fmt.Errorf("calls.JoinCallToken begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	_, isMember, err := s.loadConversationMetaTx(ctx, tx, p.ConversationID, p.UserID)
	if err != nil {
		return JoinCallTokenResult{}, fmt.Errorf("calls.JoinCallToken load conversation: %w", err)
	}
	if !isMember {
		return JoinCallTokenResult{}, ErrNotMember
	}

	activeCall, exists, err := s.findActiveCallTx(ctx, tx, p.ConversationID)
	if err != nil {
		return JoinCallTokenResult{}, fmt.Errorf("calls.JoinCallToken find active call: %w", err)
	}
	if !exists {
		return JoinCallTokenResult{}, ErrCallNotActive
	}

	if err := s.upsertParticipantTx(ctx, tx, activeCall.ID, p.UserID); err != nil {
		return JoinCallTokenResult{}, err
	}

	identityName, err := s.lookupUserDisplayNameTx(ctx, tx, p.UserID)
	if err != nil {
		return JoinCallTokenResult{}, fmt.Errorf("calls.JoinCallToken lookup identity: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return JoinCallTokenResult{}, fmt.Errorf("calls.JoinCallToken commit: %w", err)
	}

	token, err := s.mintJoinToken(activeCall.LiveKitRoom, p.UserID, identityName)
	if err != nil {
		return JoinCallTokenResult{}, err
	}

	return JoinCallTokenResult{
		LiveKitURL:   s.cfg.LiveKitURL,
		LiveKitToken: token,
		LiveKitRoom:  activeCall.LiveKitRoom,
	}, nil
}

func (s *Service) InviteCallMembers(ctx context.Context, p InviteCallMembersParams) (InviteCallMembersResult, error) {
	if p.ConversationID == uuid.Nil || p.ActorID == uuid.Nil {
		return InviteCallMembersResult{}, ErrBadRequest
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return InviteCallMembersResult{}, fmt.Errorf("calls.InviteCallMembers begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	_, isMember, err := s.loadConversationMetaTx(ctx, tx, p.ConversationID, p.ActorID)
	if err != nil {
		return InviteCallMembersResult{}, fmt.Errorf("calls.InviteCallMembers load conversation: %w", err)
	}
	if !isMember {
		return InviteCallMembersResult{}, ErrNotMember
	}

	activeCall, exists, err := s.findActiveCallTx(ctx, tx, p.ConversationID)
	if err != nil {
		return InviteCallMembersResult{}, fmt.Errorf("calls.InviteCallMembers find active call: %w", err)
	}
	if !exists {
		return InviteCallMembersResult{}, ErrCallNotActive
	}

	actorInCall, err := s.isActiveParticipantTx(ctx, tx, activeCall.ID, p.ActorID)
	if err != nil {
		return InviteCallMembersResult{}, err
	}
	if !actorInCall {
		return InviteCallMembersResult{}, ErrForbiddenAction
	}

	invitees, membershipSkipped, err := s.resolveProvidedInviteesTx(ctx, tx, p.ConversationID, p.ActorID, p.InviteeUserIDs)
	if err != nil {
		return InviteCallMembersResult{}, err
	}

	invited := make([]uuid.UUID, 0, len(invitees))
	skipped := make([]uuid.UUID, 0, len(invitees)+len(membershipSkipped))
	skipped = append(skipped, membershipSkipped...)
	directDeliveries := make([]DirectDelivery, 0, len(invitees)*3)

	for _, inviteeID := range invitees {
		inCall, err := s.isActiveParticipantTx(ctx, tx, activeCall.ID, inviteeID)
		if err != nil {
			return InviteCallMembersResult{}, err
		}
		if inCall {
			skipped = append(skipped, inviteeID)
			continue
		}

		hasPendingInvite, err := s.hasActiveInviteForCallTx(ctx, tx, activeCall.ID, inviteeID)
		if err != nil {
			return InviteCallMembersResult{}, err
		}
		if hasPendingInvite {
			skipped = append(skipped, inviteeID)
			continue
		}

		rejectedDeliveries, err := s.rejectOlderActiveInvitesTx(ctx, tx, inviteeID)
		if err != nil {
			return InviteCallMembersResult{}, err
		}
		directDeliveries = append(directDeliveries, rejectedDeliveries...)

		invite, err := s.createInviteTx(ctx, tx, activeCall.ID, p.ConversationID, p.ActorID, inviteeID)
		if err != nil {
			return InviteCallMembersResult{}, err
		}
		directDeliveries = append(directDeliveries, DirectDelivery{
			UserID: inviteeID.String(),
			Event:  s.buildCallInviteCreatedEvent(invite),
		})

		notification, err := s.createInviteNotificationTx(ctx, tx, p.ConversationID, p.ActorID, inviteeID)
		if err != nil {
			return InviteCallMembersResult{}, err
		}
		directDeliveries = append(directDeliveries, DirectDelivery{
			UserID: inviteeID.String(),
			Event:  s.buildNotificationAddedEvent(inviteeID, notification),
		})

		invited = append(invited, inviteeID)
	}

	if err := tx.Commit(ctx); err != nil {
		return InviteCallMembersResult{}, fmt.Errorf("calls.InviteCallMembers commit: %w", err)
	}

	return InviteCallMembersResult{
		CallID:           activeCall.ID,
		ConversationID:   p.ConversationID,
		InvitedUserIDs:   invited,
		SkippedUserIDs:   skipped,
		DirectDeliveries: directDeliveries,
	}, nil
}

func (s *Service) AcceptInvite(ctx context.Context, p InviteActionParams) (InviteActionResult, error) {
	if p.InviteID == uuid.Nil || p.ActorID == uuid.Nil {
		return InviteActionResult{}, ErrBadRequest
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.AcceptInvite begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	invite, err := s.loadInviteForUpdateTx(ctx, tx, p.InviteID)
	if err != nil {
		return InviteActionResult{}, err
	}
	if invite.InviteeID != p.ActorID {
		return InviteActionResult{}, ErrForbiddenAction
	}
	if invite.State != "created" {
		return InviteActionResult{}, ErrInviteNotActive
	}
	if invite.ExpiresAt.Before(time.Now().UTC()) || invite.CallStatus != "active" {
		if err := s.expireInviteTx(ctx, tx, invite.ID); err != nil {
			return InviteActionResult{}, err
		}
		return InviteActionResult{}, ErrInviteNotActive
	}

	if _, err := tx.Exec(ctx, `
		UPDATE call_invites
		   SET state = 'accepted',
		       updated_at = now()
		 WHERE id = $1
		   AND state = 'created'`, invite.ID); err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.AcceptInvite update invite: %w", err)
	}

	if err := s.upsertParticipantTx(ctx, tx, invite.CallID, p.ActorID); err != nil {
		return InviteActionResult{}, err
	}

	directDeliveries, err := s.resolveInviteNotificationTx(ctx, tx, invite.ChannelID, invite.InviteeID)
	if err != nil {
		return InviteActionResult{}, err
	}
	directDeliveries = append(directDeliveries, DirectDelivery{
		UserID: invite.InviteeID.String(),
		Event:  s.buildCallInviteCancelledEvent(invite.ID.String(), packetspb.InviteCancelReason_INVITE_CANCEL_REASON_CANCELLED, p.ActorID),
	})

	if err := tx.Commit(ctx); err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.AcceptInvite commit: %w", err)
	}

	return InviteActionResult{
		InviteID:         invite.ID,
		ResultingState:   packetspb.InviteState_INVITE_STATE_ACCEPTED,
		Applied:          true,
		DirectDeliveries: directDeliveries,
	}, nil
}

func (s *Service) RejectInvite(ctx context.Context, p InviteActionParams) (InviteActionResult, error) {
	if p.InviteID == uuid.Nil || p.ActorID == uuid.Nil {
		return InviteActionResult{}, ErrBadRequest
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.RejectInvite begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	invite, err := s.loadInviteForUpdateTx(ctx, tx, p.InviteID)
	if err != nil {
		return InviteActionResult{}, err
	}
	if invite.InviteeID != p.ActorID {
		return InviteActionResult{}, ErrForbiddenAction
	}
	if invite.State != "created" {
		return InviteActionResult{}, ErrInviteNotActive
	}

	if _, err := tx.Exec(ctx, `
		UPDATE call_invites
		   SET state = 'rejected',
		       updated_at = now()
		 WHERE id = $1
		   AND state = 'created'`, invite.ID); err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.RejectInvite update invite: %w", err)
	}

	directDeliveries, err := s.resolveInviteNotificationTx(ctx, tx, invite.ChannelID, invite.InviteeID)
	if err != nil {
		return InviteActionResult{}, err
	}
	directDeliveries = append(directDeliveries, DirectDelivery{
		UserID: invite.InviteeID.String(),
		Event:  s.buildCallInviteCancelledEvent(invite.ID.String(), packetspb.InviteCancelReason_INVITE_CANCEL_REASON_REJECTED, p.ActorID),
	})

	if err := tx.Commit(ctx); err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.RejectInvite commit: %w", err)
	}

	return InviteActionResult{
		InviteID:         invite.ID,
		ResultingState:   packetspb.InviteState_INVITE_STATE_REJECTED,
		Applied:          true,
		DirectDeliveries: directDeliveries,
	}, nil
}

func (s *Service) CancelInvite(ctx context.Context, p InviteActionParams) (InviteActionResult, error) {
	if p.InviteID == uuid.Nil || p.ActorID == uuid.Nil {
		return InviteActionResult{}, ErrBadRequest
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.CancelInvite begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	invite, err := s.loadInviteForUpdateTx(ctx, tx, p.InviteID)
	if err != nil {
		return InviteActionResult{}, err
	}
	if invite.InviterID != p.ActorID && p.ActorRole != "admin" && p.ActorRole != "owner" {
		return InviteActionResult{}, ErrForbiddenAction
	}
	if invite.State != "created" {
		if err := tx.Commit(ctx); err != nil {
			return InviteActionResult{}, fmt.Errorf("calls.CancelInvite commit noop: %w", err)
		}
		return InviteActionResult{
			InviteID:       invite.ID,
			ResultingState: mapInviteState(invite.State),
			Applied:        false,
		}, nil
	}

	if _, err := tx.Exec(ctx, `
		UPDATE call_invites
		   SET state = 'cancelled',
		       cancel_reason = 'cancelled',
		       cancelled_by_id = $2,
		       updated_at = now()
		 WHERE id = $1
		   AND state = 'created'`, invite.ID, p.ActorID); err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.CancelInvite update invite: %w", err)
	}

	directDeliveries, err := s.resolveInviteNotificationTx(ctx, tx, invite.ChannelID, invite.InviteeID)
	if err != nil {
		return InviteActionResult{}, err
	}
	directDeliveries = append(directDeliveries, DirectDelivery{
		UserID: invite.InviteeID.String(),
		Event:  s.buildCallInviteCancelledEvent(invite.ID.String(), packetspb.InviteCancelReason_INVITE_CANCEL_REASON_CANCELLED, p.ActorID),
	})

	if err := tx.Commit(ctx); err != nil {
		return InviteActionResult{}, fmt.Errorf("calls.CancelInvite commit: %w", err)
	}

	return InviteActionResult{
		InviteID:         invite.ID,
		ResultingState:   packetspb.InviteState_INVITE_STATE_CANCELLED,
		Applied:          true,
		DirectDeliveries: directDeliveries,
	}, nil
}

func (s *Service) rejectOlderActiveInvitesTx(ctx context.Context, tx pgx.Tx, inviteeID uuid.UUID) ([]DirectDelivery, error) {
	rows, err := tx.Query(ctx, `
		UPDATE call_invites
		   SET state = 'rejected',
		       updated_at = now()
		 WHERE invitee_id = $1
		   AND state = 'created'
		RETURNING id, channel_id`, inviteeID)
	if err != nil {
		return nil, fmt.Errorf("calls.rejectOlderActiveInvitesTx update invites: %w", err)
	}
	defer rows.Close()

	type cancelledInvite struct {
		inviteID       uuid.UUID
		conversationID uuid.UUID
	}
	cancelledInvites := make([]cancelledInvite, 0, 4)
	for rows.Next() {
		var item cancelledInvite
		if err := rows.Scan(&item.inviteID, &item.conversationID); err != nil {
			return nil, fmt.Errorf("calls.rejectOlderActiveInvitesTx scan: %w", err)
		}
		cancelledInvites = append(cancelledInvites, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("calls.rejectOlderActiveInvitesTx rows: %w", err)
	}

	deliveries := make([]DirectDelivery, 0, len(cancelledInvites)*2)
	processedConversations := make(map[uuid.UUID]struct{}, len(cancelledInvites))
	for _, item := range cancelledInvites {
		deliveries = append(deliveries, DirectDelivery{
			UserID: inviteeID.String(),
			Event:  s.buildCallInviteCancelledEvent(item.inviteID.String(), packetspb.InviteCancelReason_INVITE_CANCEL_REASON_REJECTED, uuid.Nil),
		})

		if _, done := processedConversations[item.conversationID]; done {
			continue
		}
		processedConversations[item.conversationID] = struct{}{}
		resolved, err := s.resolveInviteNotificationTx(ctx, tx, item.conversationID, inviteeID)
		if err != nil {
			return nil, err
		}
		deliveries = append(deliveries, resolved...)
	}

	if len(cancelledInvites) > 0 {
		s.log.Info("calls invite policy rejected older active invites",
			zap.String("invitee_id", inviteeID.String()),
			zap.Int("rejected_count", len(cancelledInvites)),
		)
	}
	return deliveries, nil
}

func (s *Service) ExpireInvites(ctx context.Context) (ExpireInvitesResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ExpireInvitesResult{}, fmt.Errorf("calls.ExpireInvites begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
		UPDATE call_invites
		   SET state = 'expired',
		       cancel_reason = 'expired',
		       cancelled_by_id = NULL,
		       updated_at = now()
		 WHERE state = 'created'
		   AND expires_at <= now()
		 RETURNING id, channel_id, invitee_id`)
	if err != nil {
		return ExpireInvitesResult{}, fmt.Errorf("calls.ExpireInvites update invites: %w", err)
	}
	defer rows.Close()

	directDeliveries := make([]DirectDelivery, 0)
	expiredCount := 0
	for rows.Next() {
		expiredCount++
		var inviteID, channelID, inviteeID uuid.UUID
		if err := rows.Scan(&inviteID, &channelID, &inviteeID); err != nil {
			return ExpireInvitesResult{}, fmt.Errorf("calls.ExpireInvites scan: %w", err)
		}

		resolved, err := s.resolveInviteNotificationTx(ctx, tx, channelID, inviteeID)
		if err != nil {
			return ExpireInvitesResult{}, err
		}
		directDeliveries = append(directDeliveries, resolved...)
		directDeliveries = append(directDeliveries, DirectDelivery{
			UserID: inviteeID.String(),
			Event:  s.buildCallInviteCancelledEvent(inviteID.String(), packetspb.InviteCancelReason_INVITE_CANCEL_REASON_EXPIRED, uuid.Nil),
		})
	}
	if err := rows.Err(); err != nil {
		return ExpireInvitesResult{}, fmt.Errorf("calls.ExpireInvites rows: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return ExpireInvitesResult{}, fmt.Errorf("calls.ExpireInvites commit: %w", err)
	}

	return ExpireInvitesResult{ExpiredCount: expiredCount, DirectDeliveries: directDeliveries}, nil
}

func (s *Service) HandleWebhook(ctx context.Context, evt *lkwebhookEvent) (bool, error) {
	if evt == nil || evt.RoomName == "" {
		return false, nil
	}

	switch evt.Event {
	case webhookEventParticipantJoined:
		if evt.ParticipantIdentity == "" {
			return false, nil
		}
		userID, err := uuid.Parse(evt.ParticipantIdentity)
		if err != nil {
			return false, nil
		}
		call, err := s.findCallByRoom(ctx, evt.RoomName)
		if err != nil {
			return false, err
		}
		if call == nil {
			return false, nil
		}
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO call_participants (call_id, user_id, joined_at, left_at)
			VALUES ($1, $2, now(), NULL)
			ON CONFLICT (call_id, user_id) DO UPDATE
			   SET joined_at = now(),
			       left_at = NULL`, call.ID, userID); err != nil {
			return false, fmt.Errorf("calls.HandleWebhook participant joined: %w", err)
		}
		s.log.Info("calls webhook participant joined tracked",
			zap.String("room", evt.RoomName),
			zap.String("call_id", call.ID.String()),
			zap.String("conversation_id", call.ChannelID.String()),
			zap.String("user_id", userID.String()),
		)
		return false, nil

	case webhookEventParticipantLeft, webhookEventParticipantConnAbort:
		if evt.ParticipantIdentity == "" {
			return false, nil
		}
		userID, err := uuid.Parse(evt.ParticipantIdentity)
		if err != nil {
			return false, nil
		}
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return false, fmt.Errorf("calls.HandleWebhook participant left begin tx: %w", err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck

		call, err := s.findCallByRoomTx(ctx, tx, evt.RoomName)
		if err != nil {
			return false, err
		}
		if call == nil {
			if err := tx.Commit(ctx); err != nil {
				return false, fmt.Errorf("calls.HandleWebhook participant left noop commit: %w", err)
			}
			return false, nil
		}
		if _, err := tx.Exec(ctx, `
			UPDATE call_participants
			   SET left_at = now()
			 WHERE call_id = $1
			   AND user_id = $2
			   AND left_at IS NULL`, call.ID, userID); err != nil {
			return false, fmt.Errorf("calls.HandleWebhook participant left: %w", err)
		}

		var activeParticipants int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*)
			  FROM call_participants
			 WHERE call_id = $1
			   AND left_at IS NULL`, call.ID).Scan(&activeParticipants); err != nil {
			return false, fmt.Errorf("calls.HandleWebhook participant left count active participants: %w", err)
		}

		shouldEndCall := activeParticipants == 0 || (evt.HasRoomSnapshot && evt.RoomNumParticipants == 0)
		callEnded := false
		if shouldEndCall {
			tag, err := tx.Exec(ctx, `
				UPDATE calls
				   SET status = 'ended',
				       ended_at = now()
				 WHERE id = $1
				   AND status = 'active'`, call.ID)
			if err != nil {
				return false, fmt.Errorf("calls.HandleWebhook participant left end call: %w", err)
			}
			if tag.RowsAffected() > 0 {
				if err := s.appendCallStateChangedTx(ctx, tx, call.ID, call.ChannelID, packetspb.CallStatus_CALL_STATUS_ENDED); err != nil {
					return false, err
				}
				if _, err := s.cancelPendingInvitesForEndedCallTx(ctx, tx, call.ID, call.ChannelID); err != nil {
					return false, err
				}
				callEnded = true
			}
		}

		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("calls.HandleWebhook participant left commit: %w", err)
		}
		s.log.Info("calls webhook participant left processed",
			zap.String("event", evt.Event),
			zap.String("room", evt.RoomName),
			zap.String("call_id", call.ID.String()),
			zap.String("conversation_id", call.ChannelID.String()),
			zap.String("user_id", userID.String()),
			zap.Bool("has_room_snapshot", evt.HasRoomSnapshot),
			zap.Uint32("room_num_participants", evt.RoomNumParticipants),
			zap.Int("active_participants", activeParticipants),
			zap.Bool("should_end_call", shouldEndCall),
			zap.Bool("call_ended", callEnded),
		)
		if callEnded {
			return true, nil
		}
		return false, nil

	case webhookEventRoomFinished:
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return false, fmt.Errorf("calls.HandleWebhook room finished begin tx: %w", err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck

		var callID, channelID uuid.UUID
		err = tx.QueryRow(ctx, `
			UPDATE calls
			   SET status = 'ended',
			       ended_at = now()
			 WHERE livekit_room = $1
			   AND status = 'active'
			 RETURNING id, channel_id`, evt.RoomName).Scan(&callID, &channelID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				if err := tx.Commit(ctx); err != nil {
					return false, fmt.Errorf("calls.HandleWebhook room finished noop commit: %w", err)
				}
				return false, nil
			}
			return false, fmt.Errorf("calls.HandleWebhook room finished update: %w", err)
		}

		if err := s.appendCallStateChangedTx(ctx, tx, callID, channelID, packetspb.CallStatus_CALL_STATUS_ENDED); err != nil {
			return false, err
		}
		if _, err := s.cancelPendingInvitesForEndedCallTx(ctx, tx, callID, channelID); err != nil {
			return false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("calls.HandleWebhook room finished commit: %w", err)
		}
		s.log.Info("calls webhook room finished ended call",
			zap.String("room", evt.RoomName),
			zap.String("call_id", callID.String()),
			zap.String("conversation_id", channelID.String()),
		)
		return true, nil
	default:
		return false, nil
	}
}

func (s *Service) loadConversationMetaTx(ctx context.Context, tx pgx.Tx, conversationID, userID uuid.UUID) (conversationMeta, bool, error) {
	var meta conversationMeta
	var isMember bool
	err := tx.QueryRow(ctx, `
		SELECT c.kind,
		       c.visibility,
		       EXISTS (
				SELECT 1
				  FROM channel_members cm
				 WHERE cm.channel_id = c.id
				   AND cm.user_id = $2
				   AND cm.is_archived = false
		   ) AS is_member
		  FROM channels c
		 WHERE c.id = $1`, conversationID, userID).Scan(&meta.Kind, &meta.Visibility, &isMember)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return conversationMeta{}, false, ErrBadRequest
		}
		return conversationMeta{}, false, err
	}
	return meta, isMember, nil
}

func (s *Service) findActiveCallTx(ctx context.Context, tx pgx.Tx, conversationID uuid.UUID) (callRow, bool, error) {
	var row callRow
	err := tx.QueryRow(ctx, `
		SELECT id, channel_id, livekit_room
		  FROM calls
		 WHERE channel_id = $1
		   AND status = 'active'
		 ORDER BY started_at DESC
		 LIMIT 1`, conversationID).Scan(&row.ID, &row.ChannelID, &row.LiveKitRoom)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return callRow{}, false, nil
		}
		return callRow{}, false, err
	}
	return row, true, nil
}

func (s *Service) resolveInviteesTx(ctx context.Context, tx pgx.Tx, meta conversationMeta, conversationID, initiatorID uuid.UUID, provided []uuid.UUID) ([]uuid.UUID, error) {
	if meta.Kind == "dm" {
		var peerID uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT cm.user_id
			  FROM channel_members cm
			  JOIN users u ON u.id = cm.user_id
			 WHERE cm.channel_id = $1
			   AND cm.user_id <> $2
			   AND cm.is_archived = false
			   AND u.status = 'active'
			 ORDER BY cm.created_at ASC
			 LIMIT 1`, conversationID, initiatorID).Scan(&peerID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrBadRequest
			}
			return nil, err
		}
		return []uuid.UUID{peerID}, nil
	}

	seen := make(map[uuid.UUID]struct{}, len(provided))
	invitees := make([]uuid.UUID, 0, len(provided))
	for _, userID := range provided {
		if userID == initiatorID || userID == uuid.Nil {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		var eligible bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				  FROM channel_members cm
				  JOIN users u ON u.id = cm.user_id
				 WHERE cm.channel_id = $1
				   AND cm.user_id = $2
				   AND cm.is_archived = false
				   AND u.status = 'active'
			)`, conversationID, userID).Scan(&eligible); err != nil {
			return nil, err
		}
		if !eligible {
			return nil, ErrBadRequest
		}
		invitees = append(invitees, userID)
	}
	return invitees, nil
}

func (s *Service) resolveProvidedInviteesTx(ctx context.Context, tx pgx.Tx, conversationID, actorID uuid.UUID, provided []uuid.UUID) ([]uuid.UUID, []uuid.UUID, error) {
	seen := make(map[uuid.UUID]struct{}, len(provided))
	invitees := make([]uuid.UUID, 0, len(provided))
	skipped := make([]uuid.UUID, 0, len(provided))
	for _, userID := range provided {
		if userID == actorID || userID == uuid.Nil {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		var eligible bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				  FROM channel_members cm
				  JOIN users u ON u.id = cm.user_id
				 WHERE cm.channel_id = $1
				   AND cm.user_id = $2
				   AND cm.is_archived = false
				   AND u.status = 'active'
			)`, conversationID, userID).Scan(&eligible); err != nil {
			return nil, nil, err
		}
		if !eligible {
			skipped = append(skipped, userID)
			continue
		}
		invitees = append(invitees, userID)
	}
	return invitees, skipped, nil
}

func (s *Service) isActiveParticipantTx(ctx context.Context, tx pgx.Tx, callID, userID uuid.UUID) (bool, error) {
	var inCall bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			  FROM call_participants
			 WHERE call_id = $1
			   AND user_id = $2
			   AND left_at IS NULL
		)`, callID, userID).Scan(&inCall); err != nil {
		return false, fmt.Errorf("calls.isActiveParticipantTx: %w", err)
	}
	return inCall, nil
}

func (s *Service) hasActiveInviteForCallTx(ctx context.Context, tx pgx.Tx, callID, inviteeID uuid.UUID) (bool, error) {
	var hasInvite bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			  FROM call_invites
			 WHERE call_id = $1
			   AND invitee_id = $2
			   AND state = 'created'
		)`, callID, inviteeID).Scan(&hasInvite); err != nil {
		return false, fmt.Errorf("calls.hasActiveInviteForCallTx: %w", err)
	}
	return hasInvite, nil
}

func (s *Service) createInviteTx(ctx context.Context, tx pgx.Tx, callID, conversationID, inviterID, inviteeID uuid.UUID) (*packetspb.CallInviteSummary, error) {
	expiresAt := time.Now().UTC().Add(s.cfg.CallInviteTTL)
	var inviteID uuid.UUID
	var createdAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO call_invites (call_id, channel_id, inviter_id, invitee_id, state, expires_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'created', $5, now(), now())
		RETURNING id, created_at`, callID, conversationID, inviterID, inviteeID, expiresAt).Scan(&inviteID, &createdAt); err != nil {
		return nil, fmt.Errorf("calls.createInviteTx insert invite: %w", err)
	}
	return &packetspb.CallInviteSummary{
		InviteId:       inviteID.String(),
		CallId:         callID.String(),
		ConversationId: conversationID.String(),
		InviterUserId:  inviterID.String(),
		CreatedAt:      timestamppb.New(createdAt),
		ExpiresAt:      timestamppb.New(expiresAt),
		State:          packetspb.InviteState_INVITE_STATE_CREATED,
	}, nil
}

func (s *Service) createInviteNotificationTx(ctx context.Context, tx pgx.Tx, conversationID, inviterID, inviteeID uuid.UUID) (notificationRow, error) {
	var inviterName string
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(display_name, ''), email)
		  FROM users
		 WHERE id = $1`, inviterID).Scan(&inviterName); err != nil {
		return notificationRow{}, fmt.Errorf("calls.createInviteNotificationTx lookup inviter: %w", err)
	}

	var row notificationRow
	err := tx.QueryRow(ctx, `
		INSERT INTO notifications (user_id, type, title, body, channel_id, is_read, created_at)
		VALUES ($1, 'call_invite', 'Incoming call', $2, $3, false, now())
		RETURNING id, type, title, body, channel_id, is_read, created_at`,
		inviteeID,
		fmt.Sprintf("%s is calling", inviterName),
		conversationID,
	).Scan(&row.ID, &row.Type, &row.Title, &row.Body, &row.ChannelID, &row.IsRead, &row.CreatedAt)
	if err != nil {
		return notificationRow{}, fmt.Errorf("calls.createInviteNotificationTx insert notification: %w", err)
	}
	return row, nil
}

func (s *Service) resolveInviteNotificationTx(ctx context.Context, tx pgx.Tx, conversationID, userID uuid.UUID) ([]DirectDelivery, error) {
	rows, err := tx.Query(ctx, `
		UPDATE notifications
		   SET resolved_at = now(),
		       is_read = true
		 WHERE user_id = $1
		   AND channel_id = $2
		   AND type = 'call_invite'
		   AND resolved_at IS NULL
		RETURNING id`, userID, conversationID)
	if err != nil {
		return nil, fmt.Errorf("calls.resolveInviteNotificationTx update notifications: %w", err)
	}
	defer rows.Close()

	deliveries := make([]DirectDelivery, 0)
	for rows.Next() {
		var notificationID uuid.UUID
		if err := rows.Scan(&notificationID); err != nil {
			return nil, fmt.Errorf("calls.resolveInviteNotificationTx scan: %w", err)
		}
		deliveries = append(deliveries, DirectDelivery{
			UserID: userID.String(),
			Event:  s.buildNotificationResolvedEvent(userID, notificationID),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("calls.resolveInviteNotificationTx rows: %w", err)
	}
	return deliveries, nil
}

func (s *Service) upsertParticipantTx(ctx context.Context, tx pgx.Tx, callID, userID uuid.UUID) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO call_participants (call_id, user_id, joined_at, left_at)
		VALUES ($1, $2, now(), NULL)
		ON CONFLICT (call_id, user_id) DO UPDATE
		   SET joined_at = now(),
		       left_at = NULL`, callID, userID); err != nil {
		return fmt.Errorf("calls.upsertParticipantTx upsert participant: %w", err)
	}
	return nil
}

func (s *Service) lookupUserDisplayNameTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (string, error) {
	var name string
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(display_name, ''), email)
		  FROM users
		 WHERE id = $1`, userID).Scan(&name); err != nil {
		return "", err
	}
	return name, nil
}

func (s *Service) mintJoinToken(room string, userID uuid.UUID, displayName string) (string, error) {
	if strings.TrimSpace(s.cfg.LiveKitAPIKey) == "" || strings.TrimSpace(s.cfg.LiveKitAPISecret) == "" {
		return "", fmt.Errorf("calls.mintJoinToken: livekit credentials are not configured")
	}
	grant := &lkauth.VideoGrant{
		RoomJoin: true,
		Room:     room,
	}
	token, err := lkauth.NewAccessToken(s.cfg.LiveKitAPIKey, s.cfg.LiveKitAPISecret).
		SetIdentity(userID.String()).
		SetName(displayName).
		SetVideoGrant(grant).
		SetValidFor(2 * time.Hour).
		ToJWT()
	if err != nil {
		return "", fmt.Errorf("calls.mintJoinToken: %w", err)
	}
	return token, nil
}

func (s *Service) appendCallStateChangedTx(ctx context.Context, tx pgx.Tx, callID, conversationID uuid.UUID, status packetspb.CallStatus) error {
	payload := &packetspb.CallStateChangedEvent{
		CallId:         callID.String(),
		ConversationId: conversationID.String(),
		Status:         status,
	}
	payloadJSON, err := protojson.Marshal(payload)
	if err != nil {
		return fmt.Errorf("calls.appendCallStateChangedTx marshal payload: %w", err)
	}

	stored, err := s.eventStore.AppendEventTx(ctx, tx, events.AppendParams{
		EventID:      uuid.NewString(),
		EventType:    "call_state_changed",
		ChannelID:    conversationID.String(),
		PayloadJSON:  payloadJSON,
		OccurredAt:   time.Now().UTC(),
		ProtoPayload: s.buildCallStateChangedEnvelope(callID, conversationID, status),
	})
	if err != nil {
		return fmt.Errorf("calls.appendCallStateChangedTx append event: %w", err)
	}
	if err := s.eventStore.NotifyEventTx(ctx, tx, stored.Seq); err != nil {
		return fmt.Errorf("calls.appendCallStateChangedTx notify event: %w", err)
	}
	return nil
}

func (s *Service) appendCallInviteCancelledTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID uuid.UUID,
	inviteID uuid.UUID,
	reason packetspb.InviteCancelReason,
	cancelledBy uuid.UUID,
) error {
	payload := &packetspb.CallInviteCancelledEvent{
		InviteId: inviteID.String(),
		Reason:   reason,
	}
	if cancelledBy != uuid.Nil {
		payload.CancelledByUserId = cancelledBy.String()
	}
	payloadJSON, err := protojson.Marshal(payload)
	if err != nil {
		return fmt.Errorf("calls.appendCallInviteCancelledTx marshal payload: %w", err)
	}

	stored, err := s.eventStore.AppendEventTx(ctx, tx, events.AppendParams{
		EventID:      uuid.NewString(),
		EventType:    "call_invite_cancelled",
		ChannelID:    conversationID.String(),
		PayloadJSON:  payloadJSON,
		OccurredAt:   time.Now().UTC(),
		ProtoPayload: s.buildCallInviteCancelledEvent(inviteID.String(), reason, cancelledBy),
	})
	if err != nil {
		return fmt.Errorf("calls.appendCallInviteCancelledTx append event: %w", err)
	}
	if err := s.eventStore.NotifyEventTx(ctx, tx, stored.Seq); err != nil {
		return fmt.Errorf("calls.appendCallInviteCancelledTx notify event: %w", err)
	}
	return nil
}

func (s *Service) appendNotificationResolvedTx(ctx context.Context, tx pgx.Tx, conversationID, userID, notificationID uuid.UUID) error {
	payload := &packetspb.NotificationResolvedEvent{
		NotificationId: notificationID.String(),
		UserId:         userID.String(),
	}
	payloadJSON, err := protojson.Marshal(payload)
	if err != nil {
		return fmt.Errorf("calls.appendNotificationResolvedTx marshal payload: %w", err)
	}

	stored, err := s.eventStore.AppendEventTx(ctx, tx, events.AppendParams{
		EventID:      uuid.NewString(),
		EventType:    "notification_resolved",
		ChannelID:    conversationID.String(),
		PayloadJSON:  payloadJSON,
		OccurredAt:   time.Now().UTC(),
		ProtoPayload: s.buildNotificationResolvedEvent(userID, notificationID),
	})
	if err != nil {
		return fmt.Errorf("calls.appendNotificationResolvedTx append event: %w", err)
	}
	if err := s.eventStore.NotifyEventTx(ctx, tx, stored.Seq); err != nil {
		return fmt.Errorf("calls.appendNotificationResolvedTx notify event: %w", err)
	}
	return nil
}

func (s *Service) cancelPendingInvitesForEndedCallTx(ctx context.Context, tx pgx.Tx, callID, conversationID uuid.UUID) (int, error) {
	rows, err := tx.Query(ctx, `
		UPDATE call_invites
		   SET state = 'rejected',
		       updated_at = now()
		 WHERE call_id = $1
		   AND state = 'created'
		RETURNING id, invitee_id`, callID)
	if err != nil {
		return 0, fmt.Errorf("calls.cancelPendingInvitesForEndedCallTx update invites: %w", err)
	}
	defer rows.Close()

	type inviteCancelRow struct {
		inviteID  uuid.UUID
		inviteeID uuid.UUID
	}
	cancelledInvites := make([]inviteCancelRow, 0, 8)
	for rows.Next() {
		var inviteID uuid.UUID
		var inviteeID uuid.UUID
		if err := rows.Scan(&inviteID, &inviteeID); err != nil {
			return 0, fmt.Errorf("calls.cancelPendingInvitesForEndedCallTx scan invite: %w", err)
		}
		cancelledInvites = append(cancelledInvites, inviteCancelRow{inviteID: inviteID, inviteeID: inviteeID})
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("calls.cancelPendingInvitesForEndedCallTx rows: %w", err)
	}

	for _, invite := range cancelledInvites {
		if err := s.appendCallInviteCancelledTx(ctx, tx, conversationID, invite.inviteID, packetspb.InviteCancelReason_INVITE_CANCEL_REASON_REJECTED, uuid.Nil); err != nil {
			return 0, err
		}

		notificationRows, err := tx.Query(ctx, `
			UPDATE notifications
			   SET resolved_at = now(),
			       is_read = true
			 WHERE user_id = $1
			   AND channel_id = $2
			   AND type = 'call_invite'
			   AND resolved_at IS NULL
			RETURNING id`, invite.inviteeID, conversationID)
		if err != nil {
			return 0, fmt.Errorf("calls.cancelPendingInvitesForEndedCallTx resolve notifications: %w", err)
		}
		notificationIDs := make([]uuid.UUID, 0, 4)
		for notificationRows.Next() {
			var notificationID uuid.UUID
			if err := notificationRows.Scan(&notificationID); err != nil {
				notificationRows.Close()
				return 0, fmt.Errorf("calls.cancelPendingInvitesForEndedCallTx scan notification: %w", err)
			}
			notificationIDs = append(notificationIDs, notificationID)
		}
		if err := notificationRows.Err(); err != nil {
			notificationRows.Close()
			return 0, fmt.Errorf("calls.cancelPendingInvitesForEndedCallTx notification rows: %w", err)
		}
		notificationRows.Close()
		for _, notificationID := range notificationIDs {
			if err := s.appendNotificationResolvedTx(ctx, tx, conversationID, invite.inviteeID, notificationID); err != nil {
				return 0, err
			}
		}
	}

	if len(cancelledInvites) > 0 {
		s.log.Info("calls ended cleanup cancelled pending invites",
			zap.String("call_id", callID.String()),
			zap.String("conversation_id", conversationID.String()),
			zap.Int("cancelled_count", len(cancelledInvites)),
		)
	}
	return len(cancelledInvites), nil
}

func (s *Service) buildCallStateChangedEnvelope(callID, conversationID uuid.UUID, status packetspb.CallStatus) *packetspb.ServerEvent {
	return &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_CALL_STATE_CHANGED,
		ConversationId: conversationID.String(),
		Payload: &packetspb.ServerEvent_CallStateChanged{
			CallStateChanged: &packetspb.CallStateChangedEvent{
				CallId:         callID.String(),
				ConversationId: conversationID.String(),
				Status:         status,
			},
		},
	}
}

func (s *Service) buildCallInviteCreatedEvent(invite *packetspb.CallInviteSummary) *packetspb.ServerEvent {
	return &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_CALL_INVITE_CREATED,
		ConversationId: invite.GetConversationId(),
		Payload: &packetspb.ServerEvent_CallInviteCreated{
			CallInviteCreated: &packetspb.CallInviteCreatedEvent{Invite: invite},
		},
	}
}

func (s *Service) buildCallInviteCancelledEvent(inviteID string, reason packetspb.InviteCancelReason, cancelledBy uuid.UUID) *packetspb.ServerEvent {
	cancelledByID := ""
	if cancelledBy != uuid.Nil {
		cancelledByID = cancelledBy.String()
	}
	return &packetspb.ServerEvent{
		EventType: packetspb.EventType_EVENT_TYPE_CALL_INVITE_CANCELLED,
		Payload: &packetspb.ServerEvent_CallInviteCancelled{
			CallInviteCancelled: &packetspb.CallInviteCancelledEvent{
				InviteId:          inviteID,
				Reason:            reason,
				CancelledByUserId: cancelledByID,
			},
		},
	}
}

func (s *Service) buildNotificationAddedEvent(userID uuid.UUID, row notificationRow) *packetspb.ServerEvent {
	return &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_NOTIFICATION_ADDED,
		ConversationId: row.ChannelID.String(),
		Payload: &packetspb.ServerEvent_NotificationAdded{
			NotificationAdded: &packetspb.NotificationAddedEvent{
				Notification: &packetspb.NotificationSummary{
					NotificationId: row.ID.String(),
					Type:           mapNotificationType(row.Type),
					Title:          row.Title,
					Body:           row.Body,
					ConversationId: row.ChannelID.String(),
					IsRead:         row.IsRead,
					CreatedAt:      timestamppb.New(row.CreatedAt),
				},
				UserId: userID.String(),
			},
		},
	}
}

func (s *Service) buildNotificationResolvedEvent(userID, notificationID uuid.UUID) *packetspb.ServerEvent {
	return &packetspb.ServerEvent{
		EventType: packetspb.EventType_EVENT_TYPE_NOTIFICATION_RESOLVED,
		Payload: &packetspb.ServerEvent_NotificationResolved{
			NotificationResolved: &packetspb.NotificationResolvedEvent{
				NotificationId: notificationID.String(),
				UserId:         userID.String(),
			},
		},
	}
}

func (s *Service) loadInviteForUpdateTx(ctx context.Context, tx pgx.Tx, inviteID uuid.UUID) (inviteRow, error) {
	var invite inviteRow
	err := tx.QueryRow(ctx, `
		SELECT ci.id,
		       ci.call_id,
		       ci.channel_id,
		       ci.inviter_id,
		       ci.invitee_id,
		       ci.state,
		       ci.expires_at,
		       c.status
		  FROM call_invites ci
		  JOIN calls c ON c.id = ci.call_id
		 WHERE ci.id = $1
		 FOR UPDATE`, inviteID).Scan(
		&invite.ID,
		&invite.CallID,
		&invite.ChannelID,
		&invite.InviterID,
		&invite.InviteeID,
		&invite.State,
		&invite.ExpiresAt,
		&invite.CallStatus,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return inviteRow{}, ErrInviteNotFound
		}
		return inviteRow{}, fmt.Errorf("calls.loadInviteForUpdateTx: %w", err)
	}
	return invite, nil
}

func (s *Service) expireInviteTx(ctx context.Context, tx pgx.Tx, inviteID uuid.UUID) error {
	if _, err := tx.Exec(ctx, `
		UPDATE call_invites
		   SET state = 'expired',
		       cancel_reason = 'expired',
		       cancelled_by_id = NULL,
		       updated_at = now()
		 WHERE id = $1
		   AND state = 'created'`, inviteID); err != nil {
		return fmt.Errorf("calls.expireInviteTx: %w", err)
	}
	return nil
}

func (s *Service) findCallByRoom(ctx context.Context, roomName string) (*callRow, error) {
	var row callRow
	err := s.pool.QueryRow(ctx, `
		SELECT id, channel_id, livekit_room
		  FROM calls
		 WHERE livekit_room = $1
		 ORDER BY started_at DESC
		 LIMIT 1`, roomName).Scan(&row.ID, &row.ChannelID, &row.LiveKitRoom)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("calls.findCallByRoom: %w", err)
	}
	return &row, nil
}

func (s *Service) findCallByRoomTx(ctx context.Context, tx pgx.Tx, roomName string) (*callRow, error) {
	var row callRow
	err := tx.QueryRow(ctx, `
		SELECT id, channel_id, livekit_room
		  FROM calls
		 WHERE livekit_room = $1
		 ORDER BY started_at DESC
		 LIMIT 1
		 FOR UPDATE`, roomName).Scan(&row.ID, &row.ChannelID, &row.LiveKitRoom)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("calls.findCallByRoomTx: %w", err)
	}
	return &row, nil
}

func mapNotificationType(raw string) packetspb.NotificationType {
	switch raw {
	case "mention":
		return packetspb.NotificationType_NOTIFICATION_TYPE_MENTION
	case "thread_reply":
		return packetspb.NotificationType_NOTIFICATION_TYPE_THREAD_REPLY
	case "call_invite":
		return packetspb.NotificationType_NOTIFICATION_TYPE_CALL_INVITE
	case "call_missed":
		return packetspb.NotificationType_NOTIFICATION_TYPE_CALL_MISSED
	case "system":
		return packetspb.NotificationType_NOTIFICATION_TYPE_SYSTEM
	default:
		return packetspb.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED
	}
}

func mapInviteState(raw string) packetspb.InviteState {
	switch raw {
	case "created":
		return packetspb.InviteState_INVITE_STATE_CREATED
	case "accepted":
		return packetspb.InviteState_INVITE_STATE_ACCEPTED
	case "rejected":
		return packetspb.InviteState_INVITE_STATE_REJECTED
	case "cancelled":
		return packetspb.InviteState_INVITE_STATE_CANCELLED
	case "expired":
		return packetspb.InviteState_INVITE_STATE_EXPIRED
	default:
		return packetspb.InviteState_INVITE_STATE_UNSPECIFIED
	}
}

type lkwebhookEvent struct {
	Event               string
	RoomName            string
	ParticipantIdentity string
	RoomNumParticipants uint32
	HasRoomSnapshot     bool
}

func (s *Service) ParseVerifiedWebhookRequest(r *http.Request) (*lkwebhookEvent, error) {
	defer r.Body.Close()
	s.log.Info("calls webhook verify start",
		zap.String("method", r.Method),
		zap.String("path", r.URL.Path),
		zap.String("remote_addr", r.RemoteAddr),
		zap.Bool("has_auth_header", strings.TrimSpace(r.Header.Get("Authorization")) != ""),
		zap.Bool("has_webhook_secret_header", strings.TrimSpace(r.Header.Get("X-LiveKit-Webhook-Secret")) != ""),
		zap.Int64("content_length", r.ContentLength),
	)
	body, err := io.ReadAll(r.Body)
	if err != nil || len(body) == 0 {
		s.log.Warn("calls webhook verify failed: empty body",
			zap.Error(err),
			zap.Int("body_len", len(body)),
		)
		return nil, ErrBadRequest
	}

	if s.cfg.LiveKitWebhookSecret != "" {
		token := strings.TrimSpace(r.Header.Get("X-LiveKit-Webhook-Secret"))
		if token == "" {
			s.log.Info("calls webhook verify: optional secret header not present; relying on Authorization signature")
		} else if token != s.cfg.LiveKitWebhookSecret {
			s.log.Warn("calls webhook verify failed: secret header mismatch", zap.Bool("secret_present", true))
			return nil, ErrForbiddenAction
		}
	}

	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader == "" {
		s.log.Warn("calls webhook verify failed: missing Authorization header")
		return nil, ErrForbiddenAction
	}
	token, err := lkauth.ParseAPIToken(authHeader)
	if err != nil {
		s.log.Warn("calls webhook verify failed: parse api token", zap.Error(err))
		return nil, ErrForbiddenAction
	}
	if token.APIKey() != s.cfg.LiveKitAPIKey {
		s.log.Warn("calls webhook verify failed: api key mismatch")
		return nil, ErrForbiddenAction
	}
	_, claims, err := token.Verify(s.cfg.LiveKitAPISecret)
	if err != nil {
		s.log.Warn("calls webhook verify failed: token verify", zap.Error(err))
		return nil, ErrForbiddenAction
	}

	sum := sha256.Sum256(body)
	expected := base64.StdEncoding.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(expected), []byte(claims.Sha256)) != 1 {
		s.log.Warn("calls webhook verify failed: sha256 mismatch")
		return nil, ErrForbiddenAction
	}

	var evt livekitpb.WebhookEvent
	if err := (protojson.UnmarshalOptions{
		DiscardUnknown: true,
		AllowPartial:   true,
	}).Unmarshal(body, &evt); err != nil {
		s.log.Warn("calls webhook verify failed: invalid payload", zap.Error(err))
		return nil, ErrBadRequest
	}

	out := &lkwebhookEvent{Event: evt.GetEvent()}
	if evt.GetRoom() != nil {
		out.RoomName = evt.GetRoom().GetName()
		out.RoomNumParticipants = evt.GetRoom().GetNumParticipants()
		out.HasRoomSnapshot = true
	}
	if evt.GetParticipant() != nil {
		out.ParticipantIdentity = evt.GetParticipant().GetIdentity()
	}
	s.log.Info("calls webhook verify success",
		zap.String("event", out.Event),
		zap.String("room", out.RoomName),
		zap.String("participant_identity", out.ParticipantIdentity),
		zap.Bool("has_room_snapshot", out.HasRoomSnapshot),
		zap.Uint32("room_num_participants", out.RoomNumParticipants),
	)
	return out, nil
}
