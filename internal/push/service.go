package push

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"go.uber.org/zap"

	"msgnr/internal/calls"
	"msgnr/internal/chat"
	"msgnr/internal/config"
	packetspb "msgnr/internal/gen/proto"
	"msgnr/internal/gen/queries"
	"msgnr/internal/logger"
)

// SessionChecker determines whether a user has active WS connections.
type SessionChecker interface {
	HasActiveSessions(userID string) bool
	HasActiveWindowSessions(userID string) bool
}

// Service handles Web Push notification delivery.
type Service struct {
	db             *sql.DB
	q              *queries.Queries
	cfg            *config.Config
	sessionChecker SessionChecker
	log            *zap.Logger
	startedAt      time.Time

	// In-memory rate limiter: key = "userID:conversationID", value = last push time.
	rateMu   sync.Mutex
	rateMap  map[string]time.Time
	rateWind time.Duration
}

// NewService creates a push notification service.
// If VAPID keys are not configured, the service is inert (all sends are no-ops).
func NewService(pool *pgxpool.Pool, cfg *config.Config, sc SessionChecker) *Service {
	sqlDB := stdlib.OpenDBFromPool(pool)
	return &Service{
		db:             sqlDB,
		q:              queries.New(sqlDB),
		cfg:            cfg,
		sessionChecker: sc,
		log:            logger.Logger.Named("push"),
		startedAt:      time.Now().UTC(),
		rateMap:        make(map[string]time.Time),
		rateWind:       cfg.PushRateLimitWindow,
	}
}

// Enabled returns true when VAPID keys are configured and push delivery is active.
func (s *Service) Enabled() bool {
	return s.cfg.VAPIDPublicKey != "" && s.cfg.VAPIDPrivateKey != ""
}

// Subscribe stores (upserts) a push subscription for a user.
func (s *Service) Subscribe(ctx context.Context, userID uuid.UUID, req SubscribeRequest) error {
	if req.Endpoint == "" || req.KeyP256dh == "" || req.KeyAuth == "" {
		return fmt.Errorf("endpoint, key_p256dh, and key_auth are required")
	}
	_, err := s.q.UpsertPushSubscription(ctx, queries.UpsertPushSubscriptionParams{
		UserID:    userID,
		Endpoint:  req.Endpoint,
		KeyP256dh: req.KeyP256dh,
		KeyAuth:   req.KeyAuth,
		UserAgent: req.UserAgent,
	})
	return err
}

// Unsubscribe removes a push subscription by endpoint for the given user.
func (s *Service) Unsubscribe(ctx context.Context, userID uuid.UUID, endpoint string) error {
	return s.q.DeletePushSubscriptionByUserAndEndpoint(ctx, queries.DeletePushSubscriptionByUserAndEndpointParams{
		UserID:   userID,
		Endpoint: endpoint,
	})
}

// ---------------------------------------------------------------------------
// PushNotifier interface implementation (called by ws.Server)
// ---------------------------------------------------------------------------

// PushChatDeliveries sends push notifications for chat DirectDeliveries whose
// target users are offline. Only NOTIFICATION_ADDED events produce push.
func (s *Service) PushChatDeliveries(deliveries []chat.DirectDelivery) {
	// Chat pushes are driven from MESSAGE_CREATED bus events so that we can
	// notify on every new message without duplicating mention/thread pushes.
	_ = deliveries
}

// PushMessageCreated sends pushes for a message_created event to offline
// conversation members with notification_level=ALL (0), excluding the sender.
func (s *Service) PushMessageCreated(evt *packetspb.ServerEvent) {
	if !s.Enabled() || evt == nil || evt.GetEventType() != packetspb.EventType_EVENT_TYPE_MESSAGE_CREATED {
		return
	}

	// The event listener replays backlog on startup. Skip historical events to
	// avoid sending stale pushes after a server restart.
	if ts := evt.GetOccurredAt(); ts != nil && ts.AsTime().Before(s.startedAt) {
		return
	}

	msg := evt.GetMessageCreated()
	if msg == nil || msg.GetConversationId() == "" || msg.GetSenderId() == "" {
		return
	}

	channelID, err := uuid.Parse(msg.GetConversationId())
	if err != nil {
		return
	}
	senderID, err := uuid.Parse(msg.GetSenderId())
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var senderTitle string
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(display_name, ''), email, 'Someone')
		  FROM users
		 WHERE id = $1
	`, senderID).Scan(&senderTitle); err != nil {
		senderTitle = "New message"
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT user_id::text, notification_level
		  FROM channel_members
		 WHERE channel_id = $1
		   AND is_archived = false
		   AND user_id <> $2
	`, channelID, senderID)
	if err != nil {
		s.log.Warn("failed to load push recipients", zap.Error(err), zap.String("conversation_id", msg.GetConversationId()))
		return
	}
	defer rows.Close()

	hasAttachment := len(msg.GetAttachments()) > 0
	body := messagePushBody(msg.GetBody(), hasAttachment)

	for rows.Next() {
		var userID string
		var level int16
		if err := rows.Scan(&userID, &level); err != nil {
			continue
		}
		// 0 = ALL. Respect existing per-conversation notification levels.
		if level != 0 {
			continue
		}
		if s.sessionChecker != nil && s.sessionChecker.HasActiveWindowSessions(userID) {
			continue
		}
		s.sendToUser(userID, PushPayload{
			Type:           "message",
			Title:          senderTitle,
			Body:           body,
			ConversationID: msg.GetConversationId(),
			MessageID:      msg.GetMessageId(),
			URL:            "/",
		})
	}
}

// PushCallDeliveries sends push notifications for call DirectDeliveries whose
// target users are offline. Only call_invite_created + notification_added
// events produce push.
func (s *Service) PushCallDeliveries(deliveries []calls.DirectDelivery) {
	if !s.Enabled() {
		return
	}
	for _, d := range deliveries {
		if d.Event == nil {
			continue
		}
		switch d.Event.EventType {
		case packetspb.EventType_EVENT_TYPE_NOTIFICATION_ADDED:
			na := d.Event.GetNotificationAdded()
			if na == nil || na.Notification == nil {
				continue
			}
			n := na.Notification
			payload := PushPayload{
				Type:           "call_invite",
				Title:          n.Title,
				Body:           truncate(n.Body, 200),
				ConversationID: n.ConversationId,
				Tag:            "call:" + n.ConversationId,
				URL:            "/",
			}
			s.sendToUser(d.UserID, payload)

		case packetspb.EventType_EVENT_TYPE_CALL_INVITE_CREATED:
			inv := d.Event.GetCallInviteCreated()
			if inv == nil || inv.Invite == nil {
				continue
			}
			payload := PushPayload{
				Type:           "call_invite",
				Title:          "Incoming call",
				Body:           "Someone is calling you",
				ConversationID: inv.Invite.ConversationId,
				Tag:            "call:" + inv.Invite.ConversationId,
				URL:            "/",
			}
			s.sendToUser(d.UserID, payload)
		}
	}
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

// sendToUser looks up all push subscriptions for the user and sends the payload.
func (s *Service) sendToUser(userID string, payload PushPayload) {
	// Rate limit (optional): if message_id exists, limit by message to avoid
	// suppressing distinct messages in the same conversation.
	if s.rateWind > 0 {
		rateKey := userID + ":" + payload.ConversationID
		if payload.MessageID != "" {
			rateKey = userID + ":" + payload.MessageID
		}

		s.rateMu.Lock()
		if last, ok := s.rateMap[rateKey]; ok && time.Since(last) < s.rateWind {
			s.rateMu.Unlock()
			return
		}
		s.rateMap[rateKey] = time.Now()
		// Prune expired entries to prevent unbounded growth.
		if len(s.rateMap) > 1000 {
			now := time.Now()
			for k, t := range s.rateMap {
				if now.Sub(t) > s.rateWind {
					delete(s.rateMap, k)
				}
			}
		}
		s.rateMu.Unlock()
	}

	uid, err := uuid.Parse(userID)
	if err != nil {
		s.log.Warn("invalid user ID for push", zap.String("user_id", userID), zap.Error(err))
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	subs, err := s.q.ListPushSubscriptionsByUser(ctx, uid)
	if err != nil {
		s.log.Error("failed to list push subscriptions", zap.String("user_id", userID), zap.Error(err))
		return
	}
	if len(subs) == 0 {
		return
	}

	body, err := json.Marshal(payload)
	if err != nil {
		s.log.Error("failed to marshal push payload", zap.Error(err))
		return
	}

	ttlSeconds := s.cfg.PushTTLSeconds
	if ttlSeconds <= 0 {
		ttlSeconds = 60
	}

	opts := &webpush.Options{
		Subscriber:      s.cfg.VAPIDSubject,
		VAPIDPublicKey:  s.cfg.VAPIDPublicKey,
		VAPIDPrivateKey: s.cfg.VAPIDPrivateKey,
		TTL:             ttlSeconds,
		Urgency:         webpush.UrgencyHigh,
	}
	// Disable push-service collapse for chat message pushes.
	if payload.Type != "message" && payload.Tag != "" {
		opts.Topic = payload.Tag
	}

	for _, sub := range subs {
		wSub := &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys: webpush.Keys{
				Auth:   sub.KeyAuth,
				P256dh: sub.KeyP256dh,
			},
		}

		resp, err := webpush.SendNotification(body, wSub, opts)
		if err != nil {
			s.log.Warn("push send failed", zap.String("endpoint", sub.Endpoint), zap.Error(err))
			continue
		}
		resp.Body.Close()

		switch resp.StatusCode {
		case http.StatusCreated, http.StatusOK:
			// Success — touch last_used timestamp
			_ = s.q.TouchPushSubscriptionLastUsed(ctx, sub.ID)
		case http.StatusGone:
			// 410 Gone — subscription is invalid, remove it
			s.log.Info("removing stale push subscription (410 Gone)", zap.String("endpoint", sub.Endpoint))
			_ = s.q.DeletePushSubscriptionByEndpoint(ctx, sub.Endpoint)
		case http.StatusTooManyRequests:
			s.log.Warn("push rate limited by push service", zap.String("endpoint", sub.Endpoint), zap.Int("status", resp.StatusCode))
		default:
			s.log.Warn("unexpected push response", zap.String("endpoint", sub.Endpoint), zap.Int("status", resp.StatusCode))
		}
	}
}

// CleanupStaleSubscriptions removes subscriptions not used for 30 days.
// Should be called periodically (e.g., daily).
func (s *Service) CleanupStaleSubscriptions(ctx context.Context) error {
	cutoff := time.Now().Add(-30 * 24 * time.Hour)
	return s.q.DeleteStalePushSubscriptions(ctx, cutoff)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func truncate(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes-1]) + "\u2026"
}

func messagePushBody(body string, hasAttachment bool) string {
	trimmed := strings.TrimSpace(body)
	if trimmed != "" {
		return trimmed
	}
	if hasAttachment {
		return "Sent an attachment"
	}
	return "New message"
}
