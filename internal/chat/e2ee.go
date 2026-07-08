package chat

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	packetspb "msgnr/internal/gen/proto"
	"msgnr/internal/gen/queries"
)

const encryptedDMEnvelopeAlgorithm = "dm-p256-aesgcm-v1"

type RegisterDeviceParams struct {
	DeviceID              uuid.UUID
	UserID                uuid.UUID
	DeviceLabel           string
	IdentityKeyPublic     []byte
	SignedPrekeyID        int
	SignedPrekeyPublic    []byte
	SignedPrekeySignature []byte
}

type UserDeviceBundle struct {
	DeviceID              uuid.UUID
	UserID                uuid.UUID
	DeviceLabel           string
	IdentityKeyPublic     []byte
	SignedPrekeyID        int
	SignedPrekeyPublic    []byte
	SignedPrekeySignature []byte
}

func (s *Service) RegisterDevice(ctx context.Context, p RegisterDeviceParams) (UserDeviceBundle, error) {
	if p.DeviceID == uuid.Nil {
		p.DeviceID = uuid.New()
	}
	if p.UserID == uuid.Nil || len(p.IdentityKeyPublic) == 0 || len(p.SignedPrekeyPublic) == 0 || len(p.SignedPrekeySignature) == 0 {
		return UserDeviceBundle{}, ErrInvalidDMTarget
	}
	row, err := s.q.UpsertUserDevice(ctx, queries.UpsertUserDeviceParams{
		ID:                    p.DeviceID,
		UserID:                p.UserID,
		DeviceLabel:           strings.TrimSpace(p.DeviceLabel),
		IdentityKeyPublic:     append([]byte(nil), p.IdentityKeyPublic...),
		SignedPrekeyID:        p.SignedPrekeyID,
		SignedPrekeyPublic:    append([]byte(nil), p.SignedPrekeyPublic...),
		SignedPrekeySignature: append([]byte(nil), p.SignedPrekeySignature...),
	})
	if err != nil {
		return UserDeviceBundle{}, fmt.Errorf("chat.RegisterDevice: %w", err)
	}
	return UserDeviceBundle{
		DeviceID:              row.ID,
		UserID:                row.UserID,
		DeviceLabel:           row.DeviceLabel,
		IdentityKeyPublic:     row.IdentityKeyPublic,
		SignedPrekeyID:        row.SignedPrekeyID,
		SignedPrekeyPublic:    row.SignedPrekeyPublic,
		SignedPrekeySignature: row.SignedPrekeySignature,
	}, nil
}

func (s *Service) ListEncryptedDMDevices(ctx context.Context, requesterID, conversationID uuid.UUID) ([]UserDeviceBundle, error) {
	rows, err := s.q.ListActiveConversationDevices(ctx, queries.ListActiveConversationDevicesParams{
		RequesterID:    requesterID,
		ConversationID: conversationID,
	})
	if err != nil {
		return nil, fmt.Errorf("chat.ListEncryptedDMDevices: %w", err)
	}
	out := make([]UserDeviceBundle, 0, len(rows))
	for _, row := range rows {
		out = append(out, UserDeviceBundle{
			DeviceID:              row.ID,
			UserID:                row.UserID,
			DeviceLabel:           row.DeviceLabel,
			IdentityKeyPublic:     row.IdentityKeyPublic,
			SignedPrekeyID:        row.SignedPrekeyID,
			SignedPrekeyPublic:    row.SignedPrekeyPublic,
			SignedPrekeySignature: row.SignedPrekeySignature,
		})
	}
	return out, nil
}

func (s *Service) requiredEncryptedDMRecipientDevices(ctx context.Context, requesterID, conversationID uuid.UUID) (map[uuid.UUID]uuid.UUID, error) {
	rows, err := s.q.ListActiveConversationDevices(ctx, queries.ListActiveConversationDevicesParams{
		RequesterID:    requesterID,
		ConversationID: conversationID,
	})
	if err != nil {
		return nil, fmt.Errorf("chat.requiredEncryptedDMRecipientDevices: %w", err)
	}
	var memberCount int
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int
		  FROM channel_members
		 WHERE channel_id = $1
		   AND is_archived = false`,
		conversationID,
	).Scan(&memberCount); err != nil {
		return nil, fmt.Errorf("chat.requiredEncryptedDMRecipientDevices member count: %w", err)
	}
	out := make(map[uuid.UUID]uuid.UUID, len(rows))
	usersWithDevices := make(map[uuid.UUID]struct{})
	for _, row := range rows {
		out[row.ID] = row.UserID
		usersWithDevices[row.UserID] = struct{}{}
	}
	if memberCount == 0 || len(usersWithDevices) < memberCount {
		return nil, ErrInvalidEncryptedPayload
	}
	return out, nil
}

func (s *Service) activeUserDeviceIDs(ctx context.Context, userID, requestedDeviceID uuid.UUID) (map[uuid.UUID]struct{}, error) {
	out := make(map[uuid.UUID]struct{})
	if requestedDeviceID != uuid.Nil {
		active, err := s.q.IsActiveUserDevice(ctx, queries.IsActiveUserDeviceParams{
			DeviceID: requestedDeviceID,
			UserID:   userID,
		})
		if err != nil {
			return nil, fmt.Errorf("chat.activeUserDeviceIDs check requested device: %w", err)
		}
		if active {
			out[requestedDeviceID] = struct{}{}
		}
		return out, nil
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id
		  FROM user_devices
		 WHERE user_id = $1
		   AND revoked_at IS NULL`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("chat.activeUserDeviceIDs query: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var deviceID uuid.UUID
		if err := rows.Scan(&deviceID); err != nil {
			return nil, fmt.Errorf("chat.activeUserDeviceIDs scan: %w", err)
		}
		out[deviceID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chat.activeUserDeviceIDs rows: %w", err)
	}
	return out, nil
}

func (s *Service) FilterEncryptedEventPayloadsForUser(ctx context.Context, evt *packetspb.ServerEvent, userID uuid.UUID) (*packetspb.ServerEvent, error) {
	msg := evt.GetMessageCreated()
	if msg == nil || msg.GetContentMode() != packetspb.MessageContentMode_MESSAGE_CONTENT_MODE_DM_PAIRWISE_SIGNAL_V1 {
		return evt, nil
	}
	payload := msg.GetEncryptedDmPayload()
	if payload == nil || len(payload.GetRecipients()) == 0 {
		return evt, nil
	}

	allowedDeviceIDs, err := s.activeUserDeviceIDs(ctx, userID, uuid.Nil)
	if err != nil {
		return nil, err
	}
	filtered := proto.Clone(evt).(*packetspb.ServerEvent)
	filteredPayload := filtered.GetMessageCreated().GetEncryptedDmPayload()
	recipients := filteredPayload.GetRecipients()
	filteredRecipients := recipients[:0]
	for _, recipient := range recipients {
		recipientDeviceID, err := uuid.Parse(recipient.GetRecipientDeviceId())
		if err != nil {
			continue
		}
		if _, ok := allowedDeviceIDs[recipientDeviceID]; ok {
			filteredRecipients = append(filteredRecipients, recipient)
		}
	}
	filteredPayload.Recipients = filteredRecipients
	return filtered, nil
}

func StripEncryptedEventPayloads(evt *packetspb.ServerEvent) *packetspb.ServerEvent {
	msg := evt.GetMessageCreated()
	if msg == nil || msg.GetContentMode() != packetspb.MessageContentMode_MESSAGE_CONTENT_MODE_DM_PAIRWISE_SIGNAL_V1 || msg.GetEncryptedDmPayload() == nil {
		return evt
	}
	filtered := proto.Clone(evt).(*packetspb.ServerEvent)
	filtered.GetMessageCreated().EncryptedDmPayload = &packetspb.EncryptedDMMessagePayload{}
	return filtered
}
