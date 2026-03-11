package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	"msgnr/internal/events"
	packetspb "msgnr/internal/gen/proto"
	"msgnr/internal/gen/queries"
)

var (
	ErrNotMember                  = errors.New("not a channel member")
	ErrNotPublicChannel           = errors.New("not a public channel")
	ErrConversationArchived       = errors.New("conversation is archived")
	ErrInviteUnsupportedTarget    = errors.New("conversation does not support invites")
	ErrMessageNotFound            = errors.New("message not found")
	ErrInvalidThread              = errors.New("thread root does not belong to channel")
	ErrInvalidDMTarget            = errors.New("invalid dm target")
	ErrBlockedDMTarget            = errors.New("blocked dm target")
	ErrAttachmentNotFound         = errors.New("attachment not found")
	ErrAttachmentNotStaged        = errors.New("attachment is already linked to a message")
	ErrAttachmentOwnership        = errors.New("attachment does not belong to sender")
	ErrInvalidAttachment          = errors.New("invalid attachment")
	ErrEmptyMessage               = errors.New("message body and attachments are both empty")
	ErrAttachmentStoreUnavailable = errors.New("attachment storage is unavailable")
	ErrInvalidNotificationLevel   = errors.New("invalid notification level")
)

// mentionRe matches @uuid patterns in message bodies.
var mentionRe = regexp.MustCompile(`@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`)

// Service handles messaging, reactions, and thread subscriptions.
type Service struct {
	pool                *pgxpool.Pool
	q                   *queries.Queries
	eventStore          *events.Store
	attachmentStore     AttachmentStorage
	attachmentMaxSizeMB int
	log                 *zap.Logger
}

const (
	defaultAttachmentMaxSizeMB = 50
	maxMessageAttachments      = 5
)

// AttachmentStorage is the subset of object storage required for chat attachments.
type AttachmentStorage interface {
	PutObject(ctx context.Context, key string, r io.Reader, size int64, mimeType string) error
	GetObject(ctx context.Context, key string) (body io.ReadCloser, size int64, mimeType string, err error)
	DeleteObject(ctx context.Context, key string) error
}

// ByteCounter reports bytes consumed by a streaming upload reader.
type ByteCounter interface {
	BytesRead() int64
}

type DMCandidate struct {
	UserID      uuid.UUID
	DisplayName string
	Email       string
	AvatarURL   string
	Presence    string
}

type ConversationMember struct {
	UserID      uuid.UUID
	DisplayName string
	Email       string
	AvatarURL   string
}

type DirectMessage struct {
	ConversationID uuid.UUID
	UserID         uuid.UUID
	DisplayName    string
	Email          string
	AvatarURL      string
	Kind           string
	Visibility     string
}

// CreateDMResult is returned by CreateOrOpenDirectMessage.
// DirectDeliveries is non-empty when a new DM is created or an archived DM is
// restored, and contains one conversation_upserted event per participant so
// both users' sidebars are updated immediately.
type CreateDMResult struct {
	DM               DirectMessage
	DirectDeliveries []DirectDelivery
}

type LeaveConversationResult struct {
	DirectDeliveries []DirectDelivery
}

type JoinableChannel struct {
	ID             uuid.UUID
	Name           string
	Kind           string
	Visibility     string
	LastActivityAt time.Time
}

type ConversationMessage struct {
	ID                  uuid.UUID
	ConversationID      uuid.UUID
	SenderID            uuid.UUID
	SenderName          string
	Body                string
	ChannelSeq          int64
	ThreadSeq           int64
	ThreadRootMessageID uuid.UUID
	ThreadReplyCount    int32
	CreatedAt           time.Time
	MentionEveryone     bool
	Reactions           []ReactionAggregate
	MyReactions         []string
	Attachments         []MessageAttachment
}

type ReactionAggregate struct {
	Emoji string `json:"emoji"`
	Count int32  `json:"count"`
}

type MessageAttachment struct {
	ID             uuid.UUID `json:"id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	MessageID      uuid.UUID `json:"message_id"`
	FileName       string    `json:"file_name"`
	FileSize       int64     `json:"file_size"`
	MimeType       string    `json:"mime_type"`
	StorageKey     string    `json:"-"`
	UploadedBy     uuid.UUID `json:"uploaded_by"`
	CreatedAt      time.Time `json:"created_at"`
}

// NewService creates a chat Service.
func NewService(pool *pgxpool.Pool, eventStore *events.Store) *Service {
	sqlDB := stdlib.OpenDBFromPool(pool)
	return &Service{
		pool:                pool,
		q:                   queries.New(sqlDB),
		eventStore:          eventStore,
		attachmentMaxSizeMB: defaultAttachmentMaxSizeMB,
		log:                 zap.NewNop(),
	}
}

// ConfigureAttachments wires object storage and limits for chat attachments.
func (s *Service) ConfigureAttachments(store AttachmentStorage, maxSizeMB int) {
	s.attachmentStore = store
	if maxSizeMB > 0 {
		s.attachmentMaxSizeMB = maxSizeMB
	} else {
		s.attachmentMaxSizeMB = defaultAttachmentMaxSizeMB
	}
}

// SetLogger configures structured logging for non-fatal background failures.
func (s *Service) SetLogger(log *zap.Logger) {
	if log == nil {
		s.log = zap.NewNop()
		return
	}
	s.log = log
}

// ListDMCandidates returns active users except the requester.
func (s *Service) ListDMCandidates(ctx context.Context, requesterID uuid.UUID) ([]DMCandidate, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, display_name, email, avatar_url
		  FROM users
		 WHERE id <> $1
		   AND status = 'active'
		 ORDER BY lower(COALESCE(NULLIF(display_name, ''), email)), id`,
		requesterID,
	)
	if err != nil {
		return nil, fmt.Errorf("chat.ListDMCandidates query: %w", err)
	}
	defer rows.Close()

	candidates := make([]DMCandidate, 0)
	for rows.Next() {
		var candidate DMCandidate
		if err := rows.Scan(&candidate.UserID, &candidate.DisplayName, &candidate.Email, &candidate.AvatarURL); err != nil {
			return nil, fmt.Errorf("chat.ListDMCandidates scan: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chat.ListDMCandidates rows: %w", err)
	}
	return candidates, nil
}

// ListAvailablePublicChannels returns public channels where requester is not an
// active member (archived memberships are considered joinable).
func (s *Service) ListAvailablePublicChannels(ctx context.Context, requesterID uuid.UUID) ([]JoinableChannel, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id,
		       c.kind,
		       c.visibility,
		       COALESCE(NULLIF(c.name, ''), c.kind) AS name,
		       c.last_activity_at
		  FROM channels c
		 WHERE c.kind = 'channel'
		   AND c.visibility = 'public'
		   AND c.is_archived = false
			   AND NOT EXISTS (
			     SELECT 1
			       FROM channel_members cm
			      WHERE cm.channel_id = c.id
			        AND cm.user_id = $1
			        AND cm.is_archived = false
			   )
		 ORDER BY lower(COALESCE(NULLIF(c.name, ''), c.kind)), c.id`,
		requesterID,
	)
	if err != nil {
		return nil, fmt.Errorf("chat.ListAvailablePublicChannels query: %w", err)
	}
	defer rows.Close()

	channels := make([]JoinableChannel, 0)
	for rows.Next() {
		var channel JoinableChannel
		if err := rows.Scan(
			&channel.ID,
			&channel.Kind,
			&channel.Visibility,
			&channel.Name,
			&channel.LastActivityAt,
		); err != nil {
			return nil, fmt.Errorf("chat.ListAvailablePublicChannels scan: %w", err)
		}
		channels = append(channels, channel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chat.ListAvailablePublicChannels rows: %w", err)
	}
	return channels, nil
}

// ListConversationMembers returns active members for a conversation.
func (s *Service) ListConversationMembers(ctx context.Context, requesterID, conversationID uuid.UUID) ([]ConversationMember, error) {
	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: conversationID,
		UserID:    requesterID,
	})
	if err != nil {
		return nil, fmt.Errorf("chat.ListConversationMembers membership check: %w", err)
	}
	if !isMember {
		return nil, ErrNotMember
	}

	rows, err := s.pool.Query(ctx, `
			SELECT u.id, u.display_name, u.email, u.avatar_url
			  FROM channel_members cm
			  JOIN users u
			    ON u.id = cm.user_id
			 WHERE cm.channel_id = $1
			   AND cm.is_archived = false
			   AND u.status = 'active'
			 ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.email)), u.id`,
		conversationID,
	)
	if err != nil {
		return nil, fmt.Errorf("chat.ListConversationMembers query: %w", err)
	}
	defer rows.Close()

	members := make([]ConversationMember, 0)
	for rows.Next() {
		var member ConversationMember
		if err := rows.Scan(&member.UserID, &member.DisplayName, &member.Email, &member.AvatarURL); err != nil {
			return nil, fmt.Errorf("chat.ListConversationMembers scan: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chat.ListConversationMembers rows: %w", err)
	}
	return members, nil
}

// JoinPublicChannels adds requester membership to eligible public channels and
// returns joined channels in the same order as requested IDs.
func (s *Service) JoinPublicChannels(ctx context.Context, requesterID uuid.UUID, channelIDs []uuid.UUID) ([]JoinableChannel, error) {
	if len(channelIDs) == 0 {
		return []JoinableChannel{}, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("chat.JoinPublicChannels begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	joined := make([]JoinableChannel, 0, len(channelIDs))
	seen := make(map[uuid.UUID]struct{}, len(channelIDs))

	for _, channelID := range channelIDs {
		if _, ok := seen[channelID]; ok {
			continue
		}
		seen[channelID] = struct{}{}

		if _, err := tx.Exec(ctx, `
				INSERT INTO channel_members (channel_id, user_id)
				SELECT c.id, $2
				  FROM channels c
				 WHERE c.id = $1
				   AND c.kind = 'channel'
				   AND c.visibility = 'public'
				   AND c.is_archived = false
				ON CONFLICT (channel_id, user_id) DO UPDATE
				    SET is_archived = false`,
			channelID,
			requesterID,
		); err != nil {
			return nil, fmt.Errorf("chat.JoinPublicChannels insert member: %w", err)
		}

		var channel JoinableChannel
		err := tx.QueryRow(ctx, `
			SELECT c.id,
			       c.kind,
			       c.visibility,
			       COALESCE(NULLIF(c.name, ''), c.kind) AS name,
			       c.last_activity_at
			  FROM channels c
				  JOIN channel_members cm
				    ON cm.channel_id = c.id
				   AND cm.user_id = $2
				   AND cm.is_archived = false
				 WHERE c.id = $1
				   AND c.kind = 'channel'
				   AND c.visibility = 'public'
			   AND c.is_archived = false`,
			channelID,
			requesterID,
		).Scan(
			&channel.ID,
			&channel.Kind,
			&channel.Visibility,
			&channel.Name,
			&channel.LastActivityAt,
		)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return nil, fmt.Errorf("chat.JoinPublicChannels fetch channel: %w", err)
		}

		joined = append(joined, channel)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("chat.JoinPublicChannels commit: %w", err)
	}
	return joined, nil
}

// LeaveConversation archives requester membership from an existing
// conversation. The conversation and messages are preserved.
func (s *Service) LeaveConversation(ctx context.Context, requesterID, conversationID uuid.UUID) (LeaveConversationResult, error) {
	result, err := s.pool.Exec(ctx, `
		UPDATE channel_members
		   SET is_archived = true
		 WHERE channel_id = $1
		   AND user_id = $2
		   AND is_archived = false`,
		conversationID,
		requesterID,
	)
	if err != nil {
		return LeaveConversationResult{}, fmt.Errorf("chat.LeaveConversation archive membership: %w", err)
	}
	if result.RowsAffected() == 0 {
		var hasMembership bool
		if err := s.pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				  FROM channel_members
				 WHERE channel_id = $1
				   AND user_id = $2
			)`,
			conversationID, requesterID,
		).Scan(&hasMembership); err != nil {
			return LeaveConversationResult{}, fmt.Errorf("chat.LeaveConversation membership lookup: %w", err)
		}
		if !hasMembership {
			return LeaveConversationResult{}, ErrNotMember
		}
		// Already archived: treat as idempotent success with no duplicate removal event.
		return LeaveConversationResult{}, nil
	}
	return LeaveConversationResult{
		DirectDeliveries: []DirectDelivery{
			buildConversationRemovedDelivery(requesterID, conversationID, packetspb.ConversationRemovedReason_CONVERSATION_REMOVED_REASON_ARCHIVED),
		},
	}, nil
}

func (s *Service) ListRecentMessages(ctx context.Context, requesterID, conversationID uuid.UUID, limit int) ([]ConversationMessage, error) {
	messages, _, err := s.ListMessagePage(ctx, requesterID, conversationID, nil, limit)
	return messages, err
}

func (s *Service) ListMessagePage(
	ctx context.Context,
	requesterID, conversationID uuid.UUID,
	beforeChannelSeq *int64,
	limit int,
) ([]ConversationMessage, bool, error) {
	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: conversationID,
		UserID:    requesterID,
	})
	if err != nil {
		return nil, false, fmt.Errorf("chat.ListMessagePage membership check: %w", err)
	}
	if !isMember {
		return nil, false, ErrNotMember
	}

	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	queryLimit := limit + 1

	before := int64(math.MaxInt64)
	if beforeChannelSeq != nil {
		before = *beforeChannelSeq
	}

	rows, err := s.q.ListConversationMessagePage(ctx, queries.ListConversationMessagePageParams{
		ConversationID:   conversationID,
		RequesterID:      requesterID,
		BeforeChannelSeq: before,
		QueryLimit:       queryLimit,
	})
	if err != nil {
		return nil, false, fmt.Errorf("chat.ListMessagePage query: %w", err)
	}

	messages := make([]ConversationMessage, 0, len(rows))
	for _, row := range rows {
		item := ConversationMessage{
			ID:               row.ID,
			ConversationID:   row.ChannelID,
			SenderID:         row.SenderID,
			SenderName:       row.DisplayName,
			Body:             row.Body,
			ChannelSeq:       row.ChannelSeq,
			ThreadSeq:        row.ThreadSeq,
			ThreadReplyCount: int32(row.ThreadReplyCount),
			CreatedAt:        row.CreatedAt,
			MentionEveryone:  row.MentionEveryone,
		}
		if row.ThreadRootID.Valid {
			item.ThreadRootMessageID = row.ThreadRootID.UUID
		}
		reactionsJSON, err := normalizeJSONValue(row.Reactions)
		if err != nil {
			return nil, false, fmt.Errorf("chat.ListMessagePage normalize reactions: %w", err)
		}
		if len(reactionsJSON) > 0 {
			if err := json.Unmarshal(reactionsJSON, &item.Reactions); err != nil {
				return nil, false, fmt.Errorf("chat.ListMessagePage decode reactions: %w", err)
			}
		}
		myReactionsJSON, err := normalizeJSONValue(row.MyReactions)
		if err != nil {
			return nil, false, fmt.Errorf("chat.ListMessagePage normalize my reactions: %w", err)
		}
		if len(myReactionsJSON) > 0 {
			if err := json.Unmarshal(myReactionsJSON, &item.MyReactions); err != nil {
				return nil, false, fmt.Errorf("chat.ListMessagePage decode my reactions: %w", err)
			}
		}
		attachmentsJSON, err := normalizeJSONValue(row.Attachments)
		if err != nil {
			return nil, false, fmt.Errorf("chat.ListMessagePage normalize attachments: %w", err)
		}
		if len(attachmentsJSON) > 0 {
			if err := json.Unmarshal(attachmentsJSON, &item.Attachments); err != nil {
				return nil, false, fmt.Errorf("chat.ListMessagePage decode attachments: %w", err)
			}
		}
		messages = append(messages, item)
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	return messages, hasMore, nil
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

// CreateOrOpenDirectMessage returns the existing 1:1 DM for the pair or creates it.
func (s *Service) CreateOrOpenDirectMessage(ctx context.Context, requesterID, targetUserID uuid.UUID) (CreateDMResult, error) {
	if requesterID == targetUserID || targetUserID == uuid.Nil {
		return CreateDMResult{}, ErrInvalidDMTarget
	}

	target, err := s.lookupActiveDMUser(ctx, targetUserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CreateDMResult{}, ErrBlockedDMTarget
		}
		return CreateDMResult{}, fmt.Errorf("chat.CreateOrOpenDirectMessage lookup target: %w", err)
	}

	existing, restoredRows, foundExisting, err := s.findAndRestoreExistingDirectMessage(ctx, requesterID, targetUserID)
	if err != nil {
		return CreateDMResult{}, fmt.Errorf("chat.CreateOrOpenDirectMessage restore existing: %w", err)
	}
	if foundExisting {
		existing.UserID = target.UserID
		existing.DisplayName = target.DisplayName
		existing.Email = target.Email
		existing.AvatarURL = target.AvatarURL

		result := CreateDMResult{DM: existing}
		if restoredRows > 0 {
			requester, err := s.lookupActiveDMUser(ctx, requesterID)
			if err != nil {
				return CreateDMResult{}, fmt.Errorf("chat.CreateOrOpenDirectMessage lookup requester: %w", err)
			}
			result.DirectDeliveries = s.buildDMConversationUpsertedDeliveries(existing.ConversationID, requester, target)
		}
		return result, nil
	}

	// Look up requester profile so we can build the recipient's sidebar entry.
	requester, err := s.lookupActiveDMUser(ctx, requesterID)
	if err != nil {
		return CreateDMResult{}, fmt.Errorf("chat.CreateOrOpenDirectMessage lookup requester: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CreateDMResult{}, fmt.Errorf("chat.CreateOrOpenDirectMessage begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var conversationID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO channels (kind, visibility, name, created_by)
		VALUES ('dm', 'dm', '', $1)
		RETURNING id`,
		requesterID,
	).Scan(&conversationID)
	if err != nil {
		return CreateDMResult{}, fmt.Errorf("chat.CreateOrOpenDirectMessage insert channel: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO channel_members (channel_id, user_id)
		VALUES ($1, $2), ($1, $3)`,
		conversationID, requesterID, targetUserID,
	); err != nil {
		return CreateDMResult{}, fmt.Errorf("chat.CreateOrOpenDirectMessage insert members: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return CreateDMResult{}, fmt.Errorf("chat.CreateOrOpenDirectMessage commit: %w", err)
	}

	dm := DirectMessage{
		ConversationID: conversationID,
		UserID:         target.UserID,
		DisplayName:    target.DisplayName,
		Email:          target.Email,
		AvatarURL:      target.AvatarURL,
		Kind:           "dm",
		Visibility:     "dm",
	}
	deliveries := s.buildDMConversationUpsertedDeliveries(conversationID, requester, target)
	return CreateDMResult{DM: dm, DirectDeliveries: deliveries}, nil
}

// UploadMessageAttachment stores a staged attachment for a conversation.
func (s *Service) UploadMessageAttachment(ctx context.Context, p UploadMessageAttachmentParams, counter ByteCounter) (*MessageAttachment, error) {
	if s.attachmentStore == nil {
		return nil, ErrAttachmentStoreUnavailable
	}
	if strings.TrimSpace(p.FileName) == "" {
		return nil, fmt.Errorf("%w: file_name is required", ErrInvalidAttachment)
	}
	if p.MimeType == "" {
		p.MimeType = "application/octet-stream"
	}
	if p.Size < 0 {
		return nil, fmt.Errorf("%w: file size must be provided", ErrInvalidAttachment)
	}

	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: p.ConversationID,
		UserID:    p.ActorID,
	})
	if err != nil {
		return nil, fmt.Errorf("chat.UploadMessageAttachment membership check: %w", err)
	}
	if !isMember {
		return nil, ErrNotMember
	}

	maxBytes := int64(s.attachmentMaxSizeMB) * 1024 * 1024
	if p.Size > maxBytes {
		return nil, fmt.Errorf("%w: file exceeds maximum allowed size of %d MB", ErrInvalidAttachment, s.attachmentMaxSizeMB)
	}

	attachmentID := uuid.New()
	safeName := sanitiseFileNameForStorageKey(p.FileName)
	storageKey := fmt.Sprintf("chat/%s/%s/%s", p.ConversationID, attachmentID, safeName)
	if err := s.attachmentStore.PutObject(ctx, storageKey, p.Body, p.Size, p.MimeType); err != nil {
		return nil, fmt.Errorf("chat.UploadMessageAttachment put object: %w", err)
	}

	actualSize := p.Size
	if counter != nil {
		actualSize = counter.BytesRead()
		if actualSize != p.Size {
			if err := s.attachmentStore.DeleteObject(ctx, storageKey); err != nil {
				s.log.Warn("chat.UploadMessageAttachment failed to delete orphaned object",
					zap.String("storage_key", storageKey),
					zap.Error(err))
			}
			return nil, fmt.Errorf("%w: uploaded size mismatch", ErrInvalidAttachment)
		}
	}
	if actualSize > maxBytes {
		if err := s.attachmentStore.DeleteObject(ctx, storageKey); err != nil {
			s.log.Warn("chat.UploadMessageAttachment failed to delete orphaned object",
				zap.String("storage_key", storageKey),
				zap.Error(err))
		}
		return nil, fmt.Errorf("%w: file exceeds maximum allowed size of %d MB", ErrInvalidAttachment, s.attachmentMaxSizeMB)
	}

	var createdAt time.Time
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO message_attachment (
			id, conversation_id, message_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at
		) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, now())
		RETURNING created_at`,
		attachmentID,
		p.ConversationID,
		p.FileName,
		actualSize,
		p.MimeType,
		storageKey,
		p.ActorID,
	).Scan(&createdAt); err != nil {
		if cleanupErr := s.attachmentStore.DeleteObject(ctx, storageKey); cleanupErr != nil {
			s.log.Warn("chat.UploadMessageAttachment failed to delete orphaned object",
				zap.String("storage_key", storageKey),
				zap.Error(cleanupErr))
		}
		return nil, fmt.Errorf("chat.UploadMessageAttachment insert row: %w", err)
	}

	return &MessageAttachment{
		ID:             attachmentID,
		ConversationID: p.ConversationID,
		MessageID:      uuid.Nil,
		FileName:       p.FileName,
		FileSize:       actualSize,
		MimeType:       p.MimeType,
		StorageKey:     storageKey,
		UploadedBy:     p.ActorID,
		CreatedAt:      createdAt,
	}, nil
}

// DeleteStagedMessageAttachment removes an unsent attachment uploaded by the actor.
func (s *Service) DeleteStagedMessageAttachment(ctx context.Context, actorID, attachmentID uuid.UUID) error {
	if s.attachmentStore == nil {
		return ErrAttachmentStoreUnavailable
	}

	row, err := s.getMessageAttachment(ctx, attachmentID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrAttachmentNotFound
		}
		return fmt.Errorf("chat.DeleteStagedMessageAttachment load row: %w", err)
	}
	if row.UploadedBy != actorID {
		return ErrAttachmentOwnership
	}
	if row.MessageID != uuid.Nil {
		return ErrAttachmentNotStaged
	}

	if _, err := s.pool.Exec(ctx, `DELETE FROM message_attachment WHERE id = $1 AND message_id IS NULL`, attachmentID); err != nil {
		return fmt.Errorf("chat.DeleteStagedMessageAttachment delete row: %w", err)
	}
	if err := s.attachmentStore.DeleteObject(ctx, row.StorageKey); err != nil {
		s.log.Warn("chat.DeleteStagedMessageAttachment storage delete failed",
			zap.String("attachment_id", attachmentID.String()),
			zap.String("storage_key", row.StorageKey),
			zap.Error(err))
	}
	return nil
}

// DownloadMessageAttachment opens an attachment stream when the requester has
// access to the attachment's conversation and the attachment belongs to messageID.
func (s *Service) DownloadMessageAttachment(
	ctx context.Context,
	requesterID, messageID, attachmentID uuid.UUID,
) (body io.ReadCloser, size int64, mimeType, fileName string, err error) {
	if s.attachmentStore == nil {
		return nil, 0, "", "", ErrAttachmentStoreUnavailable
	}

	row, err := s.getMessageAttachment(ctx, attachmentID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, 0, "", "", ErrAttachmentNotFound
		}
		return nil, 0, "", "", fmt.Errorf("chat.DownloadMessageAttachment load row: %w", err)
	}
	if row.MessageID == uuid.Nil || row.MessageID != messageID {
		return nil, 0, "", "", ErrAttachmentNotFound
	}

	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: row.ConversationID,
		UserID:    requesterID,
	})
	if err != nil {
		return nil, 0, "", "", fmt.Errorf("chat.DownloadMessageAttachment membership check: %w", err)
	}
	if !isMember {
		return nil, 0, "", "", ErrNotMember
	}

	obj, objSize, objMimeType, err := s.attachmentStore.GetObject(ctx, row.StorageKey)
	if err != nil {
		return nil, 0, "", "", fmt.Errorf("chat.DownloadMessageAttachment get object: %w", err)
	}
	if objMimeType == "" {
		objMimeType = row.MimeType
	}
	return obj, objSize, objMimeType, row.FileName, nil
}

// SendMessageParams holds the input for SendMessage.
type SendMessageParams struct {
	ChannelID           uuid.UUID
	SenderID            uuid.UUID
	ClientMsgID         string
	Body                string
	ThreadRootMessageID uuid.UUID // zero value = not a thread reply
	AttachmentIDs       []uuid.UUID
}

// SendMessageResult is the output of SendMessage.
type SendMessageResult struct {
	MessageID        uuid.UUID
	ChannelSeq       int64
	CreatedAt        *timestamppb.Timestamp
	ClientMsgID      string
	Deduped          bool
	DirectDeliveries []DirectDelivery
}

type UpdateReadCursorParams struct {
	ChannelID   uuid.UUID
	UserID      uuid.UUID
	LastReadSeq int64
}

type UpdateReadCursorResult struct {
	ChannelID        uuid.UUID
	LastReadSeq      int64
	Counter          *packetspb.UnreadCounter
	DirectDeliveries []DirectDelivery
}

type DirectDelivery struct {
	UserID string
	Event  *packetspb.ServerEvent
}

type UploadMessageAttachmentParams struct {
	ConversationID uuid.UUID
	ActorID        uuid.UUID
	FileName       string
	MimeType       string
	Size           int64
	Body           io.Reader
}

// SendMessage persists a message and emits message_created (and optionally
// thread_summary_updated) events. It manages its own pgx transaction.
func (s *Service) SendMessage(ctx context.Context, p SendMessageParams) (SendMessageResult, error) {
	p.Body = strings.TrimSpace(p.Body)
	if len(p.AttachmentIDs) > maxMessageAttachments {
		return SendMessageResult{}, fmt.Errorf("%w: too many attachments (max %d)", ErrInvalidAttachment, maxMessageAttachments)
	}
	if p.Body == "" && len(p.AttachmentIDs) == 0 {
		return SendMessageResult{}, ErrEmptyMessage
	}

	// Dedup check outside transaction (read-only, idempotent).
	existing, err := s.findMessageByClientMsgID(ctx, p.ChannelID, p.SenderID, p.ClientMsgID)
	if err == nil {
		return SendMessageResult{
			MessageID:   existing.ID,
			ChannelSeq:  existing.ChannelSeq,
			CreatedAt:   timestamppb.New(existing.CreatedAt),
			ClientMsgID: existing.ClientMsgID,
			Deduped:     true,
		}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage dedup check: %w", err)
	}

	// Membership guard.
	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: p.ChannelID,
		UserID:    p.SenderID,
	})
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage membership check: %w", err)
	}
	if !isMember {
		return SendMessageResult{}, ErrNotMember
	}

	isReply := p.ThreadRootMessageID != uuid.Nil

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	restoredDMPeer, err := s.restoreArchivedDMPeerTx(ctx, tx, p.ChannelID, p.SenderID)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage restore dm peer: %w", err)
	}

	attachments, err := s.lockAndValidateStagedAttachmentsTx(ctx, tx, p.ChannelID, p.SenderID, p.AttachmentIDs)
	if err != nil {
		return SendMessageResult{}, err
	}

	mentionEveryone := strings.Contains(p.Body, "@everyone") || strings.Contains(p.Body, "@channel")

	var threadSeq int64
	var threadReplyAt time.Time
	if isReply {
		threadChannelID, err := s.messageChannelByIDTx(ctx, tx, p.ThreadRootMessageID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return SendMessageResult{}, ErrMessageNotFound
			}
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage resolve thread root: %w", err)
		}
		if threadChannelID != p.ChannelID {
			return SendMessageResult{}, ErrInvalidThread
		}

		// Upsert thread summary atomically.
		// next_thread_seq after upsert is for the NEXT reply; current gets (next - 1).
		var nextThreadSeq int64
		err = tx.QueryRow(ctx, `
			INSERT INTO thread_summaries (root_message_id, channel_id, reply_count, next_thread_seq, last_reply_at, last_reply_user_id)
			VALUES ($1, $2, 1, 2, now(), $3)
			ON CONFLICT (root_message_id) DO UPDATE
			    SET reply_count        = thread_summaries.reply_count + 1,
			        next_thread_seq    = thread_summaries.next_thread_seq + 1,
			        last_reply_at      = now(),
			        last_reply_user_id = $3
			RETURNING next_thread_seq`,
			p.ThreadRootMessageID, p.ChannelID, p.SenderID,
		).Scan(&nextThreadSeq)
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage upsert thread summary: %w", err)
		}
		threadSeq = nextThreadSeq - 1
		threadReplyAt = time.Now().UTC()
	}

	// Insert message with atomic channel_seq increment.
	var threadRootArg interface{} = nil
	if isReply {
		threadRootArg = p.ThreadRootMessageID
	}

	var msgID uuid.UUID
	var channelSeq int64
	var clientMsgID string
	var createdAt time.Time

	if err := tx.QueryRow(ctx, `
		WITH seq AS (
		    UPDATE channels
		    SET next_seq = next_seq + 1,
		        last_activity_at = now()
		    WHERE id = $1
		    RETURNING next_seq
		)
		INSERT INTO messages (channel_id, channel_seq, sender_id, client_msg_id, body,
		                      thread_root_id, thread_seq, mention_everyone, created_at)
		VALUES ($1, (SELECT next_seq FROM seq), $2, $3, $4, $5, $6, $7, now())
		RETURNING id, channel_seq, client_msg_id, created_at`,
		p.ChannelID, p.SenderID, p.ClientMsgID, p.Body,
		threadRootArg, threadSeq, mentionEveryone,
	).Scan(&msgID, &channelSeq, &clientMsgID, &createdAt); err != nil {
		if isUniqueViolation(err) {
			existingRow, qErr := s.findMessageByClientMsgID(ctx, p.ChannelID, p.SenderID, p.ClientMsgID)
			if qErr == nil {
				return SendMessageResult{
					MessageID:   existingRow.ID,
					ChannelSeq:  existingRow.ChannelSeq,
					CreatedAt:   timestamppb.New(existingRow.CreatedAt),
					ClientMsgID: existingRow.ClientMsgID,
					Deduped:     true,
				}, nil
			}
		}
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage insert message: %w", err)
	}

	if len(attachments) > 0 {
		ids := make([]uuid.UUID, 0, len(attachments))
		for _, attachment := range attachments {
			ids = append(ids, attachment.ID)
		}
		updatedRows, err := tx.Exec(ctx, `
			UPDATE message_attachment
			   SET message_id = $1
			 WHERE id = ANY($2::uuid[])
			   AND message_id IS NULL`,
			msgID, ids,
		)
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage link attachments: %w", err)
		}
		if int(updatedRows.RowsAffected()) != len(ids) {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage link attachments: %w", ErrAttachmentNotStaged)
		}
		for i := range attachments {
			attachments[i].MessageID = msgID
		}
	}

	directDeliveries := make([]DirectDelivery, 0)

	if restoredDMPeer != nil {
		sender, err := s.lookupActiveDMUser(ctx, p.SenderID)
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage lookup dm sender: %w", err)
		}
		// First event recreates the DM in sidebar before unread counters/message fanout arrive.
		upsert := s.buildDMConversationUpsertedDeliveries(p.ChannelID, *restoredDMPeer, sender)
		if len(upsert) > 0 {
			directDeliveries = append(directDeliveries, upsert[0])
		}
	}

	// Insert @uuid mentions.
	mentionedIDs := extractMentionUUIDs(p.Body)
	for _, uid := range mentionedIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO message_mentions (message_id, user_id, created_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING`,
			msgID, uid,
		); err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage insert mention: %w", err)
		}
		if uid == p.SenderID {
			continue
		}
		isMentionTargetMember, err := s.isChannelMemberTx(ctx, tx, p.ChannelID, uid)
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage mention membership check: %w", err)
		}
		if !isMentionTargetMember {
			continue
		}
		// Check notification level before creating a mention notification.
		mentionTargetLevel, err := s.getNotificationLevelTx(ctx, tx, p.ChannelID, uid)
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage mention notification level check: %w", err)
		}
		if mentionTargetLevel == notificationLevelNothing {
			continue // fully muted — skip notification
		}
		// MENTIONS_ONLY and ALL both receive mention notifications.
		delivery, err := s.createNotificationTx(ctx, tx, createNotificationParams{
			UserID:         uid,
			ChannelID:      p.ChannelID,
			Type:           "mention",
			Title:          "Mention",
			Body:           p.Body,
			ConversationID: p.ChannelID.String(),
		})
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage create mention notification: %w", err)
		}
		directDeliveries = append(directDeliveries, delivery)
	}

	// Build and emit message_created event.
	mentionedStrs := make([]string, len(mentionedIDs))
	for i, uid := range mentionedIDs {
		mentionedStrs[i] = uid.String()
	}
	createdAtTS := timestamppb.New(createdAt)

	msgProto := &packetspb.MessageEvent{
		ConversationId:   p.ChannelID.String(),
		MessageId:        msgID.String(),
		SenderId:         p.SenderID.String(),
		Body:             p.Body,
		ChannelSeq:       channelSeq,
		CreatedAt:        createdAtTS,
		MentionedUserIds: mentionedStrs,
		MentionEveryone:  mentionEveryone,
		Attachments:      toProtoMessageAttachments(attachments),
	}
	if isReply {
		msgProto.ThreadRootMessageId = p.ThreadRootMessageID.String()
		msgProto.ThreadSeq = threadSeq
	}

	msgServerEvt := &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_MESSAGE_CREATED,
		ConversationId: p.ChannelID.String(),
		Payload:        &packetspb.ServerEvent_MessageCreated{MessageCreated: msgProto},
	}
	msgPayloadJSON, err := protojson.Marshal(msgProto)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage marshal message event: %w", err)
	}

	stored, err := s.eventStore.AppendEventTx(ctx, tx, events.AppendParams{
		EventID:      uuid.New().String(),
		EventType:    "message_created",
		ChannelID:    p.ChannelID.String(),
		PayloadJSON:  msgPayloadJSON,
		ProtoPayload: msgServerEvt,
	})
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage append event: %w", err)
	}
	if err := s.eventStore.NotifyEventTx(ctx, tx, stored.Seq); err != nil {
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage notify event: %w", err)
	}

	// Emit thread_summary_updated for thread replies.
	if isReply {
		var replyCount int32
		var nextSeq int64
		if err := tx.QueryRow(ctx,
			`SELECT reply_count, next_thread_seq FROM thread_summaries WHERE root_message_id = $1`,
			p.ThreadRootMessageID,
		).Scan(&replyCount, &nextSeq); err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage re-fetch thread summary: %w", err)
		}

		tsEvt := &packetspb.ThreadSummaryUpdatedEvent{
			ConversationId:        p.ChannelID.String(),
			ThreadRootMessageId:   p.ThreadRootMessageID.String(),
			ReplyCount:            replyCount,
			LastThreadReplyAt:     timestamppb.New(threadReplyAt),
			LastThreadReplyUserId: p.SenderID.String(),
		}
		tsServerEvt := &packetspb.ServerEvent{
			EventType:      packetspb.EventType_EVENT_TYPE_THREAD_SUMMARY_UPDATED,
			ConversationId: p.ChannelID.String(),
			Payload:        &packetspb.ServerEvent_ThreadSummaryUpdated{ThreadSummaryUpdated: tsEvt},
		}
		tsPayloadJSON, err := protojson.Marshal(tsEvt)
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage marshal thread summary event: %w", err)
		}
		tsStored, err := s.eventStore.AppendEventTx(ctx, tx, events.AppendParams{
			EventID:      uuid.New().String(),
			EventType:    "thread_summary_updated",
			ChannelID:    p.ChannelID.String(),
			PayloadJSON:  tsPayloadJSON,
			ProtoPayload: tsServerEvt,
		})
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage append thread summary event: %w", err)
		}
		if err := s.eventStore.NotifyEventTx(ctx, tx, tsStored.Seq); err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage notify thread summary event: %w", err)
		}

		recipients, err := s.threadNotificationRecipientsTx(ctx, tx, p.ThreadRootMessageID, p.SenderID)
		if err != nil {
			return SendMessageResult{}, fmt.Errorf("chat.SendMessage thread recipients: %w", err)
		}
		for _, recipientID := range recipients {
			// Check notification level before creating a thread reply notification.
			recipientLevel, err := s.getNotificationLevelTx(ctx, tx, p.ChannelID, recipientID)
			if err != nil {
				return SendMessageResult{}, fmt.Errorf("chat.SendMessage thread notification level check: %w", err)
			}
			if recipientLevel == notificationLevelNothing {
				continue // fully muted — skip notification
			}
			// Thread replies are treated like mentions for MENTIONS_ONLY:
			// the user participated in the thread, so they should be notified.
			delivery, err := s.createNotificationTx(ctx, tx, createNotificationParams{
				UserID:         recipientID,
				ChannelID:      p.ChannelID,
				Type:           "thread_reply",
				Title:          "Thread reply",
				Body:           p.Body,
				ConversationID: p.ChannelID.String(),
			})
			if err != nil {
				return SendMessageResult{}, fmt.Errorf("chat.SendMessage create thread notification: %w", err)
			}
			directDeliveries = append(directDeliveries, delivery)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return SendMessageResult{}, fmt.Errorf("chat.SendMessage commit: %w", err)
	}

	return SendMessageResult{
		MessageID:        msgID,
		ChannelSeq:       channelSeq,
		CreatedAt:        createdAtTS,
		ClientMsgID:      clientMsgID,
		Deduped:          false,
		DirectDeliveries: directDeliveries,
	}, nil
}

func (s *Service) UpdateReadCursor(ctx context.Context, p UpdateReadCursorParams) (UpdateReadCursorResult, error) {
	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: p.ChannelID,
		UserID:    p.UserID,
	})
	if err != nil {
		return UpdateReadCursorResult{}, fmt.Errorf("chat.UpdateReadCursor membership check: %w", err)
	}
	if !isMember {
		return UpdateReadCursorResult{}, ErrNotMember
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UpdateReadCursorResult{}, fmt.Errorf("chat.UpdateReadCursor begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var nextSeq int64
	if err := tx.QueryRow(ctx,
		`SELECT next_seq FROM channels WHERE id = $1`,
		p.ChannelID,
	).Scan(&nextSeq); err != nil {
		return UpdateReadCursorResult{}, fmt.Errorf("chat.UpdateReadCursor load channel seq: %w", err)
	}

	clampedReadSeq := p.LastReadSeq
	if clampedReadSeq < 0 {
		clampedReadSeq = 0
	}
	if clampedReadSeq > nextSeq {
		clampedReadSeq = nextSeq
	}

	var persistedReadSeq int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO message_reads (channel_id, user_id, last_read_seq, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (channel_id, user_id) DO UPDATE
		    SET last_read_seq = GREATEST(message_reads.last_read_seq, EXCLUDED.last_read_seq),
		        updated_at = now()
		RETURNING last_read_seq`,
		p.ChannelID, p.UserID, clampedReadSeq,
	).Scan(&persistedReadSeq); err != nil {
		return UpdateReadCursorResult{}, fmt.Errorf("chat.UpdateReadCursor upsert read cursor: %w", err)
	}

	directDeliveries := make([]DirectDelivery, 0, 1)

	counter, err := s.buildUnreadCounterTx(ctx, tx, p.ChannelID, p.UserID, persistedReadSeq)
	if err != nil {
		return UpdateReadCursorResult{}, fmt.Errorf("chat.UpdateReadCursor build unread counter: %w", err)
	}

	directDeliveries = append(directDeliveries, s.buildReadCounterUpdatedDelivery(p.ChannelID, p.UserID, counter))

	resolvedIDs, err := s.resolveConversationNotificationsTx(ctx, tx, p.ChannelID, p.UserID)
	if err != nil {
		return UpdateReadCursorResult{}, fmt.Errorf("chat.UpdateReadCursor resolve notifications: %w", err)
	}
	for _, notificationID := range resolvedIDs {
		directDeliveries = append(directDeliveries, s.buildNotificationResolvedDelivery(p.ChannelID, p.UserID, notificationID))
	}

	if err := tx.Commit(ctx); err != nil {
		return UpdateReadCursorResult{}, fmt.Errorf("chat.UpdateReadCursor commit: %w", err)
	}

	return UpdateReadCursorResult{
		ChannelID:        p.ChannelID,
		LastReadSeq:      persistedReadSeq,
		Counter:          counter,
		DirectDeliveries: directDeliveries,
	}, nil
}

// ReactionParams holds common reaction input fields.
type ReactionParams struct {
	ChannelID  uuid.UUID
	MessageID  uuid.UUID
	UserID     uuid.UUID
	Emoji      string
	ClientOpID string
}

// ReactionResult is the output of AddReaction / RemoveReaction.
type ReactionResult struct {
	OK         bool
	MessageID  uuid.UUID
	Emoji      string
	ClientOpID string
	Applied    bool
}

// AddReaction idempotently adds a reaction and emits reaction_updated.
func (s *Service) AddReaction(ctx context.Context, p ReactionParams) (ReactionResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ReactionResult{}, fmt.Errorf("chat.AddReaction begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := s.validateReactionTargetTx(ctx, tx, p); err != nil {
		return ReactionResult{}, err
	}

	// ON CONFLICT DO NOTHING — check if inserted via RETURNING.
	var reactionMsgID *uuid.UUID
	err = tx.QueryRow(ctx,
		`INSERT INTO reactions (message_id, user_id, emoji, created_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT DO NOTHING
		 RETURNING message_id`,
		p.MessageID, p.UserID, p.Emoji,
	).Scan(&reactionMsgID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ReactionResult{}, fmt.Errorf("chat.AddReaction insert reaction: %w", err)
	}
	if reactionMsgID == nil {
		// Already existed — idempotent no-op.
		return ReactionResult{OK: true, MessageID: p.MessageID, Emoji: p.Emoji, ClientOpID: p.ClientOpID, Applied: false}, nil
	}

	var newCount int32
	if err := tx.QueryRow(ctx, `
		INSERT INTO reaction_counts (message_id, emoji, count)
		VALUES ($1, $2, 1)
		ON CONFLICT (message_id, emoji) DO UPDATE SET count = reaction_counts.count + 1
		RETURNING count`,
		p.MessageID, p.Emoji,
	).Scan(&newCount); err != nil {
		return ReactionResult{}, fmt.Errorf("chat.AddReaction increment count: %w", err)
	}

	if err := s.emitReactionUpdated(ctx, tx, p, newCount); err != nil {
		return ReactionResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ReactionResult{}, fmt.Errorf("chat.AddReaction commit: %w", err)
	}
	return ReactionResult{OK: true, MessageID: p.MessageID, Emoji: p.Emoji, ClientOpID: p.ClientOpID, Applied: true}, nil
}

// RemoveReaction idempotently removes a reaction and emits reaction_updated.
func (s *Service) RemoveReaction(ctx context.Context, p ReactionParams) (ReactionResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ReactionResult{}, fmt.Errorf("chat.RemoveReaction begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := s.validateReactionTargetTx(ctx, tx, p); err != nil {
		return ReactionResult{}, err
	}

	var deletedMsgID *uuid.UUID
	err = tx.QueryRow(ctx,
		`DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING message_id`,
		p.MessageID, p.UserID, p.Emoji,
	).Scan(&deletedMsgID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ReactionResult{}, fmt.Errorf("chat.RemoveReaction delete reaction: %w", err)
	}
	if deletedMsgID == nil {
		return ReactionResult{OK: true, MessageID: p.MessageID, Emoji: p.Emoji, ClientOpID: p.ClientOpID, Applied: false}, nil
	}

	var newCount int32
	err = tx.QueryRow(ctx,
		`UPDATE reaction_counts SET count = count - 1 WHERE message_id = $1 AND emoji = $2 RETURNING count`,
		p.MessageID, p.Emoji,
	).Scan(&newCount)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ReactionResult{}, fmt.Errorf("chat.RemoveReaction decrement count: %w", err)
	}

	if newCount <= 0 {
		if _, err := tx.Exec(ctx,
			`DELETE FROM reaction_counts WHERE message_id = $1 AND emoji = $2 AND count <= 0`,
			p.MessageID, p.Emoji,
		); err != nil {
			return ReactionResult{}, fmt.Errorf("chat.RemoveReaction delete zero count: %w", err)
		}
		newCount = 0
	}

	if err := s.emitReactionUpdated(ctx, tx, p, newCount); err != nil {
		return ReactionResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ReactionResult{}, fmt.Errorf("chat.RemoveReaction commit: %w", err)
	}
	return ReactionResult{OK: true, MessageID: p.MessageID, Emoji: p.Emoji, ClientOpID: p.ClientOpID, Applied: true}, nil
}

// SubscribeThreadParams holds input for SubscribeThread.
type SubscribeThreadParams struct {
	ChannelID           uuid.UUID
	ThreadRootMessageID uuid.UUID
	RequesterID         uuid.UUID
	LastThreadSeq       int64
}

// SubscribeThreadResult holds the response for SubscribeThread.
type SubscribeThreadResult struct {
	CurrentThreadSeq int64
	Replay           []*packetspb.MessageEvent
	DirectDeliveries []DirectDelivery
}

// SubscribeThread fetches thread replay for a subscriber.
func (s *Service) SubscribeThread(ctx context.Context, p SubscribeThreadParams) (SubscribeThreadResult, error) {
	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: p.ChannelID,
		UserID:    p.RequesterID,
	})
	if err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread membership check: %w", err)
	}
	if !isMember {
		return SubscribeThreadResult{}, ErrNotMember
	}

	threadChannelID, err := s.messageChannelByID(ctx, p.ThreadRootMessageID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SubscribeThreadResult{}, ErrMessageNotFound
		}
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread resolve thread root: %w", err)
	}
	if threadChannelID != p.ChannelID {
		return SubscribeThreadResult{}, ErrInvalidThread
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var nextThreadSeq int64
	err = tx.QueryRow(ctx,
		`SELECT next_thread_seq
		   FROM thread_summaries
		  WHERE root_message_id = $1
		  FOR UPDATE`,
		p.ThreadRootMessageID,
	).Scan(&nextThreadSeq)
	if errors.Is(err, pgx.ErrNoRows) {
		nextThreadSeq = 1
	} else if err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread get summary: %w", err)
	}

	currentSeq := nextThreadSeq - 1

	rows, err := tx.Query(ctx, `
		SELECT id, channel_id, channel_seq, sender_id, client_msg_id, body,
		       thread_root_id, thread_seq, mention_everyone, created_at
		  FROM messages
		 WHERE thread_root_id = $1
		   AND thread_seq > $2
		 ORDER BY thread_seq ASC`,
		p.ThreadRootMessageID, p.LastThreadSeq,
	)
	if err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread get messages: %w", err)
	}
	defer rows.Close()

	msgs := make([]queries.Message, 0)
	for rows.Next() {
		var m queries.Message
		if err := rows.Scan(
			&m.ID,
			&m.ChannelID,
			&m.ChannelSeq,
			&m.SenderID,
			&m.ClientMsgID,
			&m.Body,
			&m.ThreadRootID,
			&m.ThreadSeq,
			&m.MentionEveryone,
			&m.CreatedAt,
		); err != nil {
			return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread scan messages: %w", err)
		}
		msgs = append(msgs, m)
	}
	if err := rows.Err(); err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread rows: %w", err)
	}

	messageIDs := make([]uuid.UUID, 0, len(msgs))
	for _, m := range msgs {
		messageIDs = append(messageIDs, m.ID)
	}
	attachmentsByMessageID, err := s.loadMessageAttachmentsByMessageIDsTx(ctx, tx, messageIDs)
	if err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread load attachments: %w", err)
	}

	replay := make([]*packetspb.MessageEvent, 0, len(msgs))
	for _, m := range msgs {
		evt := &packetspb.MessageEvent{
			ConversationId: p.ChannelID.String(),
			MessageId:      m.ID.String(),
			SenderId:       m.SenderID.String(),
			Body:           m.Body,
			ChannelSeq:     m.ChannelSeq,
			CreatedAt:      timestamppb.New(m.CreatedAt),
			ThreadSeq:      m.ThreadSeq,
			Attachments:    toProtoMessageAttachments(attachmentsByMessageID[m.ID]),
		}
		if m.ThreadRootID.Valid {
			evt.ThreadRootMessageId = m.ThreadRootID.UUID.String()
		}
		replay = append(replay, evt)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO thread_reads (root_message_id, user_id, last_read_thread_seq, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (root_message_id, user_id) DO UPDATE
		    SET last_read_thread_seq = GREATEST(thread_reads.last_read_thread_seq, EXCLUDED.last_read_thread_seq),
		        updated_at = now()`,
		p.ThreadRootMessageID, p.RequesterID, currentSeq,
	); err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread upsert thread read: %w", err)
	}

	lastReadSeq, err := s.loadLastReadSeqTx(ctx, tx, p.ChannelID, p.RequesterID)
	if err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread get read cursor: %w", err)
	}

	counter, err := s.buildUnreadCounterTx(ctx, tx, p.ChannelID, p.RequesterID, lastReadSeq)
	if err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread build unread counter: %w", err)
	}
	directDeliveries := []DirectDelivery{
		s.buildReadCounterUpdatedDelivery(p.ChannelID, p.RequesterID, counter),
	}

	if err := tx.Commit(ctx); err != nil {
		return SubscribeThreadResult{}, fmt.Errorf("chat.SubscribeThread commit: %w", err)
	}

	return SubscribeThreadResult{
		CurrentThreadSeq: currentSeq,
		Replay:           replay,
		DirectDeliveries: directDeliveries,
	}, nil
}

// emitReactionUpdated appends a reaction_updated event within the given transaction.
func (s *Service) emitReactionUpdated(ctx context.Context, tx pgx.Tx, p ReactionParams, count int32) error {
	reEvt := &packetspb.ReactionUpdatedEvent{
		ConversationId: p.ChannelID.String(),
		MessageId:      p.MessageID.String(),
		Emoji:          p.Emoji,
		Count:          count,
	}
	reServerEvt := &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_REACTION_UPDATED,
		ConversationId: p.ChannelID.String(),
		Payload:        &packetspb.ServerEvent_ReactionUpdated{ReactionUpdated: reEvt},
	}
	rePayloadJSON, err := protojson.Marshal(reEvt)
	if err != nil {
		return fmt.Errorf("emitReactionUpdated marshal: %w", err)
	}
	stored, err := s.eventStore.AppendEventTx(ctx, tx, events.AppendParams{
		EventID:      uuid.New().String(),
		EventType:    "reaction_updated",
		ChannelID:    p.ChannelID.String(),
		PayloadJSON:  rePayloadJSON,
		ProtoPayload: reServerEvt,
	})
	if err != nil {
		return fmt.Errorf("emitReactionUpdated append: %w", err)
	}
	if err := s.eventStore.NotifyEventTx(ctx, tx, stored.Seq); err != nil {
		return fmt.Errorf("emitReactionUpdated notify: %w", err)
	}
	return nil
}

func (s *Service) lockAndValidateStagedAttachmentsTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID, senderID uuid.UUID,
	attachmentIDs []uuid.UUID,
) ([]MessageAttachment, error) {
	uniqueIDs := uniqueUUIDs(attachmentIDs)
	if len(uniqueIDs) == 0 {
		return []MessageAttachment{}, nil
	}

	rows, err := tx.Query(ctx, `
		SELECT id, conversation_id, message_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at
		  FROM message_attachment
		 WHERE id = ANY($1::uuid[])
		 FOR UPDATE`,
		uniqueIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("chat.lockAndValidateStagedAttachmentsTx query: %w", err)
	}
	defer rows.Close()

	attachments := make([]MessageAttachment, 0, len(uniqueIDs))
	for rows.Next() {
		row, err := scanMessageAttachment(rows)
		if err != nil {
			return nil, fmt.Errorf("chat.lockAndValidateStagedAttachmentsTx scan: %w", err)
		}
		switch {
		case row.ConversationID != conversationID:
			return nil, ErrInvalidAttachment
		case row.UploadedBy != senderID:
			return nil, ErrAttachmentOwnership
		case row.MessageID != uuid.Nil:
			return nil, ErrAttachmentNotStaged
		}
		attachments = append(attachments, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chat.lockAndValidateStagedAttachmentsTx rows: %w", err)
	}
	if len(attachments) != len(uniqueIDs) {
		return nil, ErrAttachmentNotFound
	}
	return attachments, nil
}

func (s *Service) loadMessageAttachmentsByMessageIDsTx(
	ctx context.Context,
	tx pgx.Tx,
	messageIDs []uuid.UUID,
) (map[uuid.UUID][]MessageAttachment, error) {
	result := make(map[uuid.UUID][]MessageAttachment)
	if len(messageIDs) == 0 {
		return result, nil
	}

	rows, err := tx.Query(ctx, `
		SELECT id, conversation_id, message_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at
		  FROM message_attachment
		 WHERE message_id = ANY($1::uuid[])
		 ORDER BY created_at ASC, id ASC`,
		messageIDs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		row, err := scanMessageAttachment(rows)
		if err != nil {
			return nil, err
		}
		if row.MessageID == uuid.Nil {
			continue
		}
		result[row.MessageID] = append(result[row.MessageID], row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) getMessageAttachment(ctx context.Context, attachmentID uuid.UUID) (MessageAttachment, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, conversation_id, message_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at
		  FROM message_attachment
		 WHERE id = $1`,
		attachmentID,
	)
	attachment, err := scanMessageAttachment(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return MessageAttachment{}, sql.ErrNoRows
		}
		return MessageAttachment{}, err
	}
	return attachment, nil
}

type attachmentScanner interface {
	Scan(dest ...any) error
}

func scanMessageAttachment(scanner attachmentScanner) (MessageAttachment, error) {
	var item MessageAttachment
	var messageID uuid.NullUUID
	err := scanner.Scan(
		&item.ID,
		&item.ConversationID,
		&messageID,
		&item.FileName,
		&item.FileSize,
		&item.MimeType,
		&item.StorageKey,
		&item.UploadedBy,
		&item.CreatedAt,
	)
	if err != nil {
		return MessageAttachment{}, err
	}
	if messageID.Valid {
		item.MessageID = messageID.UUID
	}
	return item, nil
}

func toProtoMessageAttachments(items []MessageAttachment) []*packetspb.MessageAttachment {
	if len(items) == 0 {
		return nil
	}
	out := make([]*packetspb.MessageAttachment, 0, len(items))
	for _, item := range items {
		out = append(out, &packetspb.MessageAttachment{
			AttachmentId: item.ID.String(),
			FileName:     item.FileName,
			FileSize:     item.FileSize,
			MimeType:     item.MimeType,
		})
	}
	return out
}

func uniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	unique := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique
}

// extractMentionUUIDs finds all @<uuid> patterns in the body and returns valid UUIDs.
func extractMentionUUIDs(body string) []uuid.UUID {
	matches := mentionRe.FindAllStringSubmatch(body, -1)
	seen := make(map[uuid.UUID]struct{})
	var ids []uuid.UUID
	for _, m := range matches {
		uid, err := uuid.Parse(m[1])
		if err != nil {
			continue
		}
		if _, ok := seen[uid]; !ok {
			seen[uid] = struct{}{}
			ids = append(ids, uid)
		}
	}
	return ids
}

func sanitiseFileNameForStorageKey(name string) string {
	name = strings.NewReplacer("/", "_", "\\", "_").Replace(name)
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

type existingMessageRow struct {
	ID          uuid.UUID
	ChannelSeq  int64
	ClientMsgID string
	CreatedAt   time.Time
}

type createNotificationParams struct {
	UserID         uuid.UUID
	ChannelID      uuid.UUID
	Type           string
	Title          string
	Body           string
	ConversationID string
}

func (s *Service) findMessageByClientMsgID(ctx context.Context, channelID, senderID uuid.UUID, clientMsgID string) (existingMessageRow, error) {
	var row existingMessageRow
	err := s.pool.QueryRow(ctx, `
		SELECT id, channel_seq, client_msg_id, created_at
		  FROM messages
		 WHERE channel_id = $1
		   AND sender_id = $2
		   AND client_msg_id = $3
		 LIMIT 1`,
		channelID, senderID, clientMsgID,
	).Scan(&row.ID, &row.ChannelSeq, &row.ClientMsgID, &row.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return existingMessageRow{}, sql.ErrNoRows
		}
		return existingMessageRow{}, err
	}
	return row, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (s *Service) messageChannelByID(ctx context.Context, messageID uuid.UUID) (uuid.UUID, error) {
	var channelID uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT channel_id FROM messages WHERE id = $1`, messageID).Scan(&channelID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, sql.ErrNoRows
		}
		return uuid.Nil, err
	}
	return channelID, nil
}

func (s *Service) messageChannelByIDTx(ctx context.Context, tx pgx.Tx, messageID uuid.UUID) (uuid.UUID, error) {
	var channelID uuid.UUID
	err := tx.QueryRow(ctx, `SELECT channel_id FROM messages WHERE id = $1`, messageID).Scan(&channelID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, sql.ErrNoRows
		}
		return uuid.Nil, err
	}
	return channelID, nil
}

func (s *Service) validateReactionTargetTx(ctx context.Context, tx pgx.Tx, p ReactionParams) error {
	actualChannelID, err := s.messageChannelByIDTx(ctx, tx, p.MessageID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrMessageNotFound
		}
		return fmt.Errorf("validate reaction target message: %w", err)
	}
	if actualChannelID != p.ChannelID {
		return ErrMessageNotFound
	}

	var isMember bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM channel_members
			 WHERE channel_id = $1
			   AND user_id = $2
			   AND is_archived = false
		)`,
		p.ChannelID, p.UserID,
	).Scan(&isMember); err != nil {
		return fmt.Errorf("validate reaction target membership: %w", err)
	}
	if !isMember {
		return ErrNotMember
	}
	return nil
}

func (s *Service) isChannelMemberTx(ctx context.Context, tx pgx.Tx, channelID, userID uuid.UUID) (bool, error) {
	var isMember bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM channel_members
			 WHERE channel_id = $1
			   AND user_id = $2
			   AND is_archived = false
		)`,
		channelID, userID,
	).Scan(&isMember); err != nil {
		return false, err
	}
	return isMember, nil
}

func (s *Service) createNotificationTx(ctx context.Context, tx pgx.Tx, p createNotificationParams) (DirectDelivery, error) {
	var notificationID uuid.UUID
	var createdAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO notifications (user_id, type, title, body, channel_id, is_read, created_at)
		VALUES ($1, $2, $3, $4, $5, false, now())
		RETURNING id, created_at`,
		p.UserID, p.Type, p.Title, p.Body, p.ChannelID,
	).Scan(&notificationID, &createdAt); err != nil {
		return DirectDelivery{}, err
	}

	notification := &packetspb.NotificationSummary{
		NotificationId: notificationID.String(),
		Type:           notificationTypeToProto(p.Type),
		Title:          p.Title,
		Body:           p.Body,
		ConversationId: p.ConversationID,
		IsRead:         false,
		CreatedAt:      timestamppb.New(createdAt),
	}
	serverEvt := &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_NOTIFICATION_ADDED,
		ConversationId: p.ConversationID,
		Payload: &packetspb.ServerEvent_NotificationAdded{
			NotificationAdded: &packetspb.NotificationAddedEvent{
				Notification: notification,
				UserId:       p.UserID.String(),
			},
		},
	}
	return DirectDelivery{UserID: p.UserID.String(), Event: serverEvt}, nil
}

func (s *Service) restoreArchivedDMPeerTx(
	ctx context.Context,
	tx pgx.Tx,
	channelID, senderID uuid.UUID,
) (*DMCandidate, error) {
	var peer DMCandidate
	err := tx.QueryRow(ctx, `
		WITH dm AS (
			SELECT id
			  FROM channels
			 WHERE id = $1
			   AND kind = 'dm'
			   AND visibility = 'dm'
		),
		restored AS (
			UPDATE channel_members cm
			   SET is_archived = false
			  FROM dm
			 WHERE cm.channel_id = dm.id
			   AND cm.user_id <> $2
			   AND cm.is_archived = true
			RETURNING cm.user_id
		)
		SELECT u.id, u.display_name, u.email, u.avatar_url, COALESCE(up.status, 'offline')
		  FROM restored r
		  JOIN users u ON u.id = r.user_id
		  LEFT JOIN user_presence up ON up.user_id = u.id
		 LIMIT 1`,
		channelID, senderID,
	).Scan(&peer.UserID, &peer.DisplayName, &peer.Email, &peer.AvatarURL, &peer.Presence)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &peer, nil
}

func (s *Service) loadLastReadSeqTx(ctx context.Context, tx pgx.Tx, channelID, userID uuid.UUID) (int64, error) {
	var lastReadSeq int64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(last_read_seq, 0)
		  FROM message_reads
		 WHERE channel_id = $1
		   AND user_id = $2`,
		channelID, userID,
	).Scan(&lastReadSeq); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return lastReadSeq, nil
}

func (s *Service) buildUnreadCounterTx(ctx context.Context, tx pgx.Tx, channelID, userID uuid.UUID, lastReadSeq int64) (*packetspb.UnreadCounter, error) {
	// Fetch notification level to respect mute/mentions-only settings.
	level, err := s.getNotificationLevelTx(ctx, tx, channelID, userID)
	if err != nil {
		return nil, fmt.Errorf("buildUnreadCounterTx notification level: %w", err)
	}

	// NOTHING: all counters are zero.
	if level == notificationLevelNothing {
		return &packetspb.UnreadCounter{
			ConversationId:         channelID.String(),
			UnreadMessages:         0,
			UnreadMentions:         0,
			HasUnreadThreadReplies: false,
			LastReadSeq:            lastReadSeq,
		}, nil
	}

	var unreadMessages int32
	if level == notificationLevelMentionsOnly {
		// MENTIONS_ONLY: count only mentions as unread messages.
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*)::int
			  FROM message_mentions mm
			  JOIN messages m ON m.id = mm.message_id
			 WHERE mm.user_id = $1
			   AND m.channel_id = $2
			   AND m.channel_seq > $3`,
			userID, channelID, lastReadSeq,
		).Scan(&unreadMessages); err != nil {
			return nil, err
		}
	} else {
		// ALL: normal counting.
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*)::int
			  FROM messages m
			 WHERE m.channel_id = $1
			   AND m.channel_seq > $2
			   AND m.thread_root_id IS NULL
			   AND m.sender_id <> $3`,
			channelID, lastReadSeq, userID,
		).Scan(&unreadMessages); err != nil {
			return nil, err
		}
	}

	var unreadMentions int32
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*)::int
		  FROM message_mentions mm
		  JOIN messages m ON m.id = mm.message_id
		 WHERE mm.user_id = $1
		   AND m.channel_id = $2
		   AND m.channel_seq > $3`,
		userID, channelID, lastReadSeq,
	).Scan(&unreadMentions); err != nil {
		return nil, err
	}

	var hasUnreadThreadReplies bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			  FROM thread_summaries ts
			  JOIN messages root ON root.id = ts.root_message_id
			 WHERE root.channel_id = $1
			   AND (
			   	root.sender_id = $2
			   	OR EXISTS (
			   		SELECT 1
			   		  FROM messages participant_msg
			   		 WHERE participant_msg.thread_root_id = ts.root_message_id
			   		   AND participant_msg.sender_id = $2
			   	)
			   )
			   AND COALESCE((
			   	SELECT tr.last_read_thread_seq
			   	  FROM thread_reads tr
			   	 WHERE tr.root_message_id = ts.root_message_id
			   	   AND tr.user_id = $2
			   ), 0) < GREATEST(ts.next_thread_seq - 1, 0)
		)`,
		channelID, userID,
	).Scan(&hasUnreadThreadReplies); err != nil {
		return nil, err
	}

	return &packetspb.UnreadCounter{
		ConversationId:         channelID.String(),
		UnreadMessages:         unreadMessages,
		UnreadMentions:         unreadMentions,
		HasUnreadThreadReplies: hasUnreadThreadReplies,
		LastReadSeq:            lastReadSeq,
	}, nil
}

func (s *Service) buildReadCounterUpdatedDelivery(channelID, userID uuid.UUID, counter *packetspb.UnreadCounter) DirectDelivery {
	serverEvt := &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_READ_COUNTER_UPDATED,
		ConversationId: channelID.String(),
		Payload: &packetspb.ServerEvent_ReadCounterUpdated{
			ReadCounterUpdated: &packetspb.ReadCounterUpdatedEvent{
				Counter: counter,
				UserId:  userID.String(),
			},
		},
	}
	return DirectDelivery{UserID: userID.String(), Event: serverEvt}
}

func (s *Service) resolveConversationNotificationsTx(ctx context.Context, tx pgx.Tx, channelID, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
		UPDATE notifications
		   SET resolved_at = now(),
		       is_read = true
		 WHERE user_id = $1
		   AND channel_id = $2
		   AND resolved_at IS NULL
		   AND type IN ('mention', 'thread_reply')
		RETURNING id`,
		userID, channelID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Service) buildNotificationResolvedDelivery(channelID, userID, notificationID uuid.UUID) DirectDelivery {
	serverEvt := &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_NOTIFICATION_RESOLVED,
		ConversationId: channelID.String(),
		Payload: &packetspb.ServerEvent_NotificationResolved{
			NotificationResolved: &packetspb.NotificationResolvedEvent{
				NotificationId: notificationID.String(),
				UserId:         userID.String(),
			},
		},
	}
	return DirectDelivery{UserID: userID.String(), Event: serverEvt}
}

func (s *Service) threadNotificationRecipientsTx(ctx context.Context, tx pgx.Tx, rootMessageID, senderID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT candidate_id
		  FROM (
			SELECT root.sender_id AS candidate_id
			  FROM messages root
			 WHERE root.id = $1
			UNION
			SELECT participant.sender_id AS candidate_id
			  FROM messages participant
			 WHERE participant.thread_root_id = $1
		  ) candidates
		  JOIN messages root ON root.id = $1
		  JOIN channel_members cm
		    ON cm.channel_id = root.channel_id
		   AND cm.user_id = candidate_id
		   AND cm.is_archived = false
		 WHERE candidate_id <> $2`,
		rootMessageID, senderID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recipients := make([]uuid.UUID, 0)
	for rows.Next() {
		var recipient uuid.UUID
		if err := rows.Scan(&recipient); err != nil {
			return nil, err
		}
		recipients = append(recipients, recipient)
	}
	return recipients, rows.Err()
}

func notificationTypeToProto(raw string) packetspb.NotificationType {
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

func mapPresenceStatus(raw string) packetspb.PresenceStatus {
	switch raw {
	case "online":
		return packetspb.PresenceStatus_PRESENCE_STATUS_ONLINE
	case "away":
		return packetspb.PresenceStatus_PRESENCE_STATUS_AWAY
	case "offline":
		return packetspb.PresenceStatus_PRESENCE_STATUS_OFFLINE
	default:
		return packetspb.PresenceStatus_PRESENCE_STATUS_UNSPECIFIED
	}
}

func (s *Service) lookupActiveDMUser(ctx context.Context, userID uuid.UUID) (DMCandidate, error) {
	var candidate DMCandidate
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.display_name, u.email, u.avatar_url, COALESCE(up.status, 'offline')
		  FROM users u
		  LEFT JOIN user_presence up ON up.user_id = u.id
		 WHERE id = $1
		   AND u.status = 'active'`,
		userID,
	).Scan(&candidate.UserID, &candidate.DisplayName, &candidate.Email, &candidate.AvatarURL, &candidate.Presence)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DMCandidate{}, sql.ErrNoRows
		}
		return DMCandidate{}, err
	}
	return candidate, nil
}

func (s *Service) findAndRestoreExistingDirectMessage(
	ctx context.Context,
	requesterID, targetUserID uuid.UUID,
) (DirectMessage, int64, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DirectMessage{}, 0, false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var dm DirectMessage
	err = tx.QueryRow(ctx, `
		SELECT c.id, c.kind, c.visibility
		  FROM channels c
		  JOIN channel_members cm1
		    ON cm1.channel_id = c.id
		   AND cm1.user_id = $1
		  JOIN channel_members cm2
		    ON cm2.channel_id = c.id
		   AND cm2.user_id = $2
		 WHERE c.kind = 'dm'
		   AND c.visibility = 'dm'
		   AND (
		   	SELECT COUNT(*)
		   	  FROM channel_members cm
		   	 WHERE cm.channel_id = c.id
		   ) = 2
		 LIMIT 1`,
		requesterID, targetUserID,
	).Scan(&dm.ConversationID, &dm.Kind, &dm.Visibility)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DirectMessage{}, 0, false, nil
		}
		return DirectMessage{}, 0, false, err
	}

	updateResult, err := tx.Exec(ctx, `
		UPDATE channel_members
		   SET is_archived = false
		 WHERE channel_id = $1
		   AND user_id IN ($2, $3)
		   AND is_archived = true`,
		dm.ConversationID,
		requesterID,
		targetUserID,
	)
	if err != nil {
		return DirectMessage{}, 0, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return DirectMessage{}, 0, false, err
	}
	return dm, updateResult.RowsAffected(), true, nil
}

// buildDMConversationUpsertedDeliveries builds two direct-delivery
// conversation_upserted events for a freshly created DM — one per participant.
// Each event is viewer-relative: the Title and Topic reflect the *other* user
// so the frontend sidebar shows the correct display name and can look up the
// peer by user_id (stored in Topic, matching the bootstrap SQL convention).
func (s *Service) buildDMConversationUpsertedDeliveries(
	conversationID uuid.UUID,
	requester, target DMCandidate,
) []DirectDelivery {
	now := timestamppb.Now()
	build := func(recipientID, peerID uuid.UUID, peerName, peerEmail, peerPresence string) DirectDelivery {
		title := peerName
		if title == "" {
			title = peerEmail
		}
		summary := &packetspb.ConversationSummary{
			ConversationId:   conversationID.String(),
			ConversationType: packetspb.ConversationType_CONVERSATION_TYPE_DM,
			Title:            title,
			Topic:            peerID.String(), // frontend uses Topic to identify the DM peer
			LastActivityAt:   now,
			MemberCount:      2,
			Presence:         mapPresenceStatus(peerPresence),
		}
		evt := &packetspb.ServerEvent{
			EventType:      packetspb.EventType_EVENT_TYPE_CONVERSATION_UPSERTED,
			ConversationId: conversationID.String(),
			OccurredAt:     now,
			Payload: &packetspb.ServerEvent_ConversationUpserted{
				ConversationUpserted: &packetspb.ConversationUpsertedEvent{
					Conversation: summary,
				},
			},
		}
		return DirectDelivery{UserID: recipientID.String(), Event: evt}
	}

	return []DirectDelivery{
		build(requester.UserID, target.UserID, target.DisplayName, target.Email, target.Presence),
		build(target.UserID, requester.UserID, requester.DisplayName, requester.Email, requester.Presence),
	}
}

// InviteToChannelResult is returned by InviteToChannel.
type InviteToChannelResult struct {
	DirectDeliveries []DirectDelivery
}

// InviteToChannel adds targetUserID to a public/private channel on behalf of
// requesterID (who must already be a member). The operation is idempotent —
// if the target is already a member but archived, membership is restored. A
// conversation_upserted DirectDelivery is always returned so the caller can
// push a real-time sidebar update to the invited user.
func (s *Service) InviteToChannel(ctx context.Context, requesterID, channelID, targetUserID uuid.UUID) (InviteToChannelResult, error) {
	// 1. Verify requester is a member.
	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: channelID,
		UserID:    requesterID,
	})
	if err != nil {
		return InviteToChannelResult{}, fmt.Errorf("chat.InviteToChannel membership check: %w", err)
	}
	if !isMember {
		return InviteToChannelResult{}, ErrNotMember
	}

	// 2. Verify channel supports invites (public/private channels only).
	var channel JoinableChannel
	var isArchived bool
	err = s.pool.QueryRow(ctx, `
		SELECT id, kind, visibility,
		       COALESCE(NULLIF(name, ''), kind) AS name,
		       last_activity_at,
		       is_archived
		  FROM channels
		 WHERE id = $1`,
		channelID,
	).Scan(&channel.ID, &channel.Kind, &channel.Visibility, &channel.Name, &channel.LastActivityAt, &isArchived)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return InviteToChannelResult{}, ErrNotPublicChannel
		}
		return InviteToChannelResult{}, fmt.Errorf("chat.InviteToChannel fetch channel: %w", err)
	}
	if isArchived {
		return InviteToChannelResult{}, ErrConversationArchived
	}
	if channel.Kind != "channel" || (channel.Visibility != "public" && channel.Visibility != "private") {
		return InviteToChannelResult{}, ErrInviteUnsupportedTarget
	}

	// 3. Verify target user exists and is active.
	var targetName, targetEmail string
	err = s.pool.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(display_name, ''), email), email
		  FROM users
		 WHERE id = $1
		   AND status = 'active'`,
		targetUserID,
	).Scan(&targetName, &targetEmail)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return InviteToChannelResult{}, fmt.Errorf("chat.InviteToChannel target user not found: %w", sql.ErrNoRows)
		}
		return InviteToChannelResult{}, fmt.Errorf("chat.InviteToChannel fetch target user: %w", err)
	}

	// 4. Insert or restore membership (idempotent).
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO channel_members (channel_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT (channel_id, user_id) DO UPDATE
		    SET is_archived = false`,
		channelID, targetUserID,
	); err != nil {
		return InviteToChannelResult{}, fmt.Errorf("chat.InviteToChannel insert member: %w", err)
	}

	// 5. Build a real-time delivery for the invited user so their sidebar
	//    immediately shows the new channel without waiting for re-bootstrap.
	delivery := buildChannelConversationUpsertedDelivery(targetUserID, channel)
	return InviteToChannelResult{
		DirectDeliveries: []DirectDelivery{delivery},
	}, nil
}

// buildChannelConversationUpsertedDelivery constructs a conversation_upserted
// DirectDelivery for a channel, to be pushed to a user.
func buildChannelConversationUpsertedDelivery(recipientID uuid.UUID, channel JoinableChannel) DirectDelivery {
	now := timestamppb.Now()
	conversationType := packetspb.ConversationType_CONVERSATION_TYPE_CHANNEL_PUBLIC
	if channel.Visibility == "private" {
		conversationType = packetspb.ConversationType_CONVERSATION_TYPE_CHANNEL_PRIVATE
	}
	summary := &packetspb.ConversationSummary{
		ConversationId:   channel.ID.String(),
		ConversationType: conversationType,
		Title:            channel.Name,
		LastActivityAt:   timestamppb.New(channel.LastActivityAt),
	}
	evt := &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_CONVERSATION_UPSERTED,
		ConversationId: channel.ID.String(),
		OccurredAt:     now,
		Payload: &packetspb.ServerEvent_ConversationUpserted{
			ConversationUpserted: &packetspb.ConversationUpsertedEvent{
				Conversation: summary,
			},
		},
	}
	return DirectDelivery{UserID: recipientID.String(), Event: evt}
}

// Notification level constants derived from proto enum for DB comparison.
const (
	notificationLevelAll          = int16(packetspb.NotificationLevel_NOTIFICATION_LEVEL_ALL)
	notificationLevelMentionsOnly = int16(packetspb.NotificationLevel_NOTIFICATION_LEVEL_MENTIONS_ONLY)
	notificationLevelNothing      = int16(packetspb.NotificationLevel_NOTIFICATION_LEVEL_NOTHING)
)

// SetNotificationLevelParams holds the input for SetNotificationLevel.
type SetNotificationLevelParams struct {
	ChannelID uuid.UUID
	UserID    uuid.UUID
	Level     packetspb.NotificationLevel
}

// SetNotificationLevelResult carries the persisted level and direct deliveries
// for syncing other sessions of the same user.
type SetNotificationLevelResult struct {
	Level            packetspb.NotificationLevel
	DirectDeliveries []DirectDelivery
}

// SetNotificationLevel updates the per-member notification level for a
// conversation and returns a direct delivery to sync the user's other sessions.
func (s *Service) SetNotificationLevel(ctx context.Context, p SetNotificationLevelParams) (SetNotificationLevelResult, error) {
	if p.Level < 0 || p.Level > 2 {
		return SetNotificationLevelResult{}, fmt.Errorf("%w: notification level must be 0, 1, or 2", ErrInvalidNotificationLevel)
	}

	isMember, err := s.q.IsChannelMember(ctx, queries.IsChannelMemberParams{
		ChannelID: p.ChannelID,
		UserID:    p.UserID,
	})
	if err != nil {
		return SetNotificationLevelResult{}, fmt.Errorf("chat.SetNotificationLevel membership check: %w", err)
	}
	if !isMember {
		return SetNotificationLevelResult{}, ErrNotMember
	}

	if err := s.q.SetNotificationLevel(ctx, queries.SetNotificationLevelParams{
		ChannelID:         p.ChannelID,
		UserID:            p.UserID,
		NotificationLevel: int16(p.Level),
	}); err != nil {
		return SetNotificationLevelResult{}, fmt.Errorf("chat.SetNotificationLevel update: %w", err)
	}

	protoLevel := p.Level

	// Direct delivery to the user's other sessions so they sync the change.
	evt := &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_NOTIFICATION_LEVEL_CHANGED,
		ConversationId: p.ChannelID.String(),
		OccurredAt:     timestamppb.Now(),
		Payload: &packetspb.ServerEvent_NotificationLevelChanged{
			NotificationLevelChanged: &packetspb.NotificationLevelChangedEvent{
				ConversationId: p.ChannelID.String(),
				Level:          protoLevel,
			},
		},
	}

	return SetNotificationLevelResult{
		Level: protoLevel,
		DirectDeliveries: []DirectDelivery{
			{UserID: p.UserID.String(), Event: evt},
		},
	}, nil
}

// getNotificationLevelTx fetches the notification level for a user in a channel
// within an existing transaction. Returns notificationLevelAll (0) if not found.
func (s *Service) getNotificationLevelTx(ctx context.Context, tx pgx.Tx, channelID, userID uuid.UUID) (int16, error) {
	var level int16
	err := tx.QueryRow(ctx, `
		SELECT notification_level
		  FROM channel_members
		 WHERE channel_id = $1
		   AND user_id = $2
		   AND is_archived = false`,
		channelID, userID,
	).Scan(&level)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notificationLevelAll, nil
		}
		return 0, err
	}
	return level, nil
}

func buildConversationRemovedDelivery(
	recipientID, conversationID uuid.UUID,
	reason packetspb.ConversationRemovedReason,
) DirectDelivery {
	now := timestamppb.Now()
	evt := &packetspb.ServerEvent{
		EventType:      packetspb.EventType_EVENT_TYPE_CONVERSATION_REMOVED,
		ConversationId: conversationID.String(),
		OccurredAt:     now,
		Payload: &packetspb.ServerEvent_ConversationRemoved{
			ConversationRemoved: &packetspb.ConversationRemovedEvent{
				ConversationId: conversationID.String(),
				Reason:         reason,
			},
		},
	}
	return DirectDelivery{UserID: recipientID.String(), Event: evt}
}
