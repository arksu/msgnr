package ws

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"msgnr/internal/auth"
	"msgnr/internal/bootstrap"
	"msgnr/internal/calls"
	"msgnr/internal/chat"
	"msgnr/internal/config"
	"msgnr/internal/database"
	"msgnr/internal/events"
	packetspb "msgnr/internal/gen/proto"
	"msgnr/internal/logger"
	"msgnr/internal/metrics"
	syncsvc "msgnr/internal/sync"
)

const protocolVersion uint32 = 1

var supportedCapabilities = map[packetspb.FeatureCapability]struct{}{
	packetspb.FeatureCapability_FEATURE_CAPABILITY_THREADS:              {},
	packetspb.FeatureCapability_FEATURE_CAPABILITY_REACTIONS:            {},
	packetspb.FeatureCapability_FEATURE_CAPABILITY_TYPING:               {},
	packetspb.FeatureCapability_FEATURE_CAPABILITY_PRESENCE:             {},
	packetspb.FeatureCapability_FEATURE_CAPABILITY_BOOTSTRAP_PAGINATION: {},
	packetspb.FeatureCapability_FEATURE_CAPABILITY_SYNC_SINCE:           {},
	packetspb.FeatureCapability_FEATURE_CAPABILITY_CALL_INVITES:         {},
	packetspb.FeatureCapability_FEATURE_CAPABILITY_INVITE_ACTIONS:       {},
}

// outboundMsg is an item placed on the per-session outbound queue.
// A nil proto signals the writer goroutine to shut down.
type outboundMsg struct {
	env *packetspb.Envelope
}

type sessionState struct {
	windowActive bool
}

// PushNotifier is called for DirectDeliveries targeting users with no active
// WebSocket sessions. Implementations send Web Push notifications.
type PushNotifier interface {
	PushChatDeliveries(deliveries []chat.DirectDelivery)
	PushCallDeliveries(deliveries []calls.DirectDelivery)
}

// Server handles WebSocket connections and wires each authenticated session
// to the event Bus for async server-push delivery.
type Server struct {
	db             *database.DB
	config         *config.Config
	authSvc        *auth.Service
	bootstrapSvc   *bootstrap.Service
	callSvc        *calls.Service
	chatSvc        *chat.Service
	syncSvc        *syncsvc.Service
	bus            *events.Bus
	authorizeEvent func(ctx context.Context, principal auth.Principal, evt *packetspb.ServerEvent) bool
	log            *zap.Logger
	sessionMu      sync.RWMutex
	sessionsByUser map[string]map[chan outboundMsg]*sessionState
	typingMu       sync.Mutex
	typingExpiry   map[string]time.Time
	pushNotifier   PushNotifier // optional; nil means push disabled
}

// NewServer creates a Server. bus may be nil during tests that don't exercise
// the fanout path.
func NewServer(db *database.DB, cfg *config.Config, authSvc *auth.Service, bootstrapSvc *bootstrap.Service, callSvc *calls.Service, chatSvc *chat.Service, syncSvc *syncsvc.Service, bus *events.Bus) *Server {
	return &Server{
		db:           db,
		config:       cfg,
		authSvc:      authSvc,
		bootstrapSvc: bootstrapSvc,
		callSvc:      callSvc,
		chatSvc:      chatSvc,
		syncSvc:      syncSvc,
		bus:          bus,
		authorizeEvent: func(ctx context.Context, principal auth.Principal, evt *packetspb.ServerEvent) bool {
			return authSvc.CanReceiveEvent(ctx, principal, evt)
		},
		log:            logger.Logger,
		sessionsByUser: make(map[string]map[chan outboundMsg]*sessionState),
		typingExpiry:   make(map[string]time.Time),
	}
}

func (s *Server) Handler() http.HandlerFunc {
	return s.handleWebSocket
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, _, _, err := ws.UpgradeHTTP(r, w)
	if err != nil {
		metrics.WebSocketConnections.WithLabelValues("rejected").Inc()
		s.log.Warn("WebSocket upgrade failed",
			zap.String("remote_addr", r.RemoteAddr),
			zap.Error(err))
		return
	}
	metrics.ActiveWebSocketConnections.Inc()
	metrics.WebSocketConnections.WithLabelValues("accepted").Inc()
	defer metrics.ActiveWebSocketConnections.Dec()

	s.log.Info("WebSocket connected", zap.String("remote_addr", r.RemoteAddr))

	outboundQueueMax := s.config.WsOutboundQueueMax
	// outboundCh carries frames to the single writer goroutine.
	// We reserve a small headroom so that an overflow error frame can always
	// be enqueued before we close.
	const overflowHeadroom = 4
	outboundCh := make(chan outboundMsg, outboundQueueMax+overflowHeadroom)

	// writerDone is closed when the writer goroutine exits.
	writerDone := make(chan struct{})

	// Writer goroutine: single writer to the socket serialises all frames.
	go func() {
		defer close(writerDone)
		for msg := range outboundCh {
			if err := s.writeEnvelope(conn, msg.env); err != nil {
				s.log.Debug("ws writer: write error",
					zap.String("remote_addr", r.RemoteAddr),
					zap.Error(err))
				// Drain and exit; the reader loop will also notice the broken conn.
				for range outboundCh {
				}
				return
			}
		}
	}()

	// enqueue tries to put env on the outbound queue without blocking.
	// Returns false if the queue is full.
	enqueue := func(env *packetspb.Envelope) bool {
		select {
		case outboundCh <- outboundMsg{env: env}:
			return true
		default:
			return false
		}
	}

	var (
		helloComplete     bool
		authComplete      bool
		principal         auth.Principal
		unsubscribe       func()
		fanoutDone        <-chan struct{}
		unregisterSession func()
	)

	defer func() {
		_ = conn.Close()
		// Stop event subscriptions before closing the outbound channel so
		// the fanout goroutine cannot write after close.
		if unsubscribe != nil {
			unsubscribe()
		}
		if unregisterSession != nil {
			unregisterSession()
		}
		if authComplete {
			presenceCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			if err := s.setPresenceState(presenceCtx, principal.UserID, packetspb.PresenceStatus_PRESENCE_STATUS_OFFLINE); err == nil {
				s.broadcastPresence(presenceCtx, principal.UserID, packetspb.PresenceStatus_PRESENCE_STATUS_OFFLINE)
			}
			cancel()
		}
		if fanoutDone != nil {
			<-fanoutDone
		}
		close(outboundCh)
		<-writerDone
		s.log.Info("WebSocket disconnected",
			zap.String("remote_addr", r.RemoteAddr),
			zap.String("user_id", func() string {
				if authComplete {
					return principal.UserID.String()
				}
				return ""
			}()),
		)
	}()

	for {
		msg, op, err := wsutil.ReadClientData(conn)
		if err != nil {
			s.log.Debug("WebSocket read error",
				zap.String("remote_addr", r.RemoteAddr),
				zap.Error(err))
			break
		}

		metrics.MessagesReceived.Inc()

		if op != ws.OpBinary {
			enqueue(s.buildErrorEnvelope("", "", packetspb.ErrorCode_ERROR_CODE_BAD_REQUEST, "binary protobuf envelope required", 0))
			continue
		}

		var env packetspb.Envelope
		if err := proto.Unmarshal(msg, &env); err != nil {
			enqueue(s.buildErrorEnvelope("", "", packetspb.ErrorCode_ERROR_CODE_BAD_REQUEST, "invalid protobuf envelope", 0))
			continue
		}

		if env.GetProtocolVersion() != protocolVersion {
			enqueue(s.buildErrorEnvelope(env.GetRequestId(), env.GetTraceId(), packetspb.ErrorCode_ERROR_CODE_BAD_REQUEST, "unsupported protocol_version", 0))
			continue
		}

		// State 1: Hello handshake
		if !helloComplete {
			clientHelloPayload, ok := env.GetPayload().(*packetspb.Envelope_ClientHello)
			if !ok || clientHelloPayload.ClientHello == nil {
				if !enqueue(s.buildErrorEnvelope(env.GetRequestId(), env.GetTraceId(), packetspb.ErrorCode_ERROR_CODE_BAD_REQUEST, "expected client_hello as first envelope", 0)) {
					break
				}
				continue
			}

			accepted := negotiateCapabilities(clientHelloPayload.ClientHello.GetCapabilities())
			serverHello := &packetspb.ServerHello{
				Server:          "msgnr",
				ProtocolVersion: protocolVersion,
				RateLimitPolicy: &packetspb.RateLimitPolicy{
					MaxEnvelopeBytes:   1 << 20,
					PerConnectionRps:   50,
					PerConnectionBurst: 100,
					PerUserRps:         200,
					PerUserBurst:       400,
					OutboundQueueMax:   uint32(s.config.WsOutboundQueueMax),
					MaxSyncBatch:       uint32(s.config.MaxSyncBatch),
				},
				AcceptedCapabilities: accepted,
			}
			resp := &packetspb.Envelope{
				RequestId:       env.GetRequestId(),
				TraceId:         env.GetTraceId(),
				ProtocolVersion: protocolVersion,
				Payload:         &packetspb.Envelope_ServerHello{ServerHello: serverHello},
			}
			if !enqueue(resp) {
				break
			}
			helloComplete = true
			continue
		}

		// State 2: Auth step — required before any other payload
		if !authComplete {
			authReqPayload, ok := env.GetPayload().(*packetspb.Envelope_AuthRequest)
			if !ok || authReqPayload.AuthRequest == nil {
				metrics.WsAuthTotal.WithLabelValues("unauthenticated").Inc()
				s.log.Info("ws auth: non-auth payload before AuthRequest",
					zap.String("remote_addr", r.RemoteAddr),
				)
				enqueue(s.buildErrorEnvelope(env.GetRequestId(), env.GetTraceId(), packetspb.ErrorCode_ERROR_CODE_UNAUTHENTICATED, "AuthRequest required", 0))
				break
			}

			p, err := s.authSvc.VerifyAccess(r.Context(), authReqPayload.AuthRequest.GetAccessToken())
			if err != nil {
				code := packetspb.ErrorCode_ERROR_CODE_UNAUTHENTICATED
				errMsg := "unauthenticated"
				status := "unauthenticated"
				if errors.Is(err, auth.ErrUserBlocked) {
					code = packetspb.ErrorCode_ERROR_CODE_FORBIDDEN
					errMsg = "account blocked"
					status = "forbidden"
				}
				metrics.WsAuthTotal.WithLabelValues(status).Inc()
				s.log.Info("ws auth: failed",
					zap.String("remote_addr", r.RemoteAddr),
					zap.Error(err),
				)
				enqueue(s.buildErrorEnvelope(env.GetRequestId(), env.GetTraceId(), code, errMsg, 0))
				break
			}

			principal = p
			authComplete = true
			metrics.WsAuthTotal.WithLabelValues("success").Inc()
			s.log.Info("ws auth: success",
				zap.String("remote_addr", r.RemoteAddr),
				zap.String("user_id", principal.UserID.String()),
				zap.String("session_id", principal.SessionID.String()),
			)

			persistedEventSeq := int64(0)
			if s.syncSvc != nil {
				cursor, cursorErr := s.syncSvc.GetPersistedCursor(r.Context(), principal.UserID)
				if cursorErr != nil {
					s.log.Error("ws auth: failed to load persisted cursor",
						zap.String("user_id", principal.UserID.String()),
						zap.Error(cursorErr),
					)
				} else {
					persistedEventSeq = cursor
				}
			}

			resp := &packetspb.Envelope{
				RequestId:       env.GetRequestId(),
				TraceId:         env.GetTraceId(),
				ProtocolVersion: protocolVersion,
				Payload: &packetspb.Envelope_AuthResponse{
					AuthResponse: &packetspb.AuthResponse{
						Ok:                true,
						UserId:            principal.UserID.String(),
						SessionId:         principal.SessionID.String(),
						PersistedEventSeq: persistedEventSeq,
						UserRole:          mapWorkspaceRole(principal.Role),
					},
				},
			}
			if !enqueue(resp) {
				break
			}

			// Register as an event bus subscriber after successful auth.
			if s.bus != nil {
				unsubscribe, fanoutDone = s.startEventFanout(conn, principal, outboundCh, outboundQueueMax)
			}
			unregisterSession = s.registerUserSession(principal.UserID.String(), outboundCh)
			presenceCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			if err := s.setPresenceState(presenceCtx, principal.UserID, packetspb.PresenceStatus_PRESENCE_STATUS_ONLINE); err != nil {
				s.log.Error("ws auth: failed to update presence", zap.Error(err))
			} else {
				s.broadcastPresence(presenceCtx, principal.UserID, packetspb.PresenceStatus_PRESENCE_STATUS_ONLINE)
			}
			cancel()
			continue
		}

		// State 3: Authenticated — domain payload dispatch.
		s.handleDomainPayload(r.Context(), &env, principal, outboundCh, enqueue)
	}
}

// startEventFanout subscribes to the Bus and launches a goroutine that
// forwards received ServerEvents to outboundCh. It returns an unsubscribe
// function; calling it stops the fanout goroutine and removes the subscription.
func (s *Server) startEventFanout(
	conn net.Conn,
	principal auth.Principal,
	outboundCh chan outboundMsg,
	queueMax int,
) (func(), <-chan struct{}) {
	filter := func(evt *packetspb.ServerEvent) bool {
		if s.authorizeEvent == nil {
			return false
		}
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		return s.authorizeEvent(ctx, principal, evt)
	}
	_, eventCh, unsubscribe := s.bus.Subscribe(filter, s.config.EventBusSubscriberBuffer)
	done := make(chan struct{})

	go func() {
		defer close(done)
		sessionID := principal.SessionID.String()
		userID := principal.UserID.String()

		for evt := range eventCh {
			env := &packetspb.Envelope{
				ProtocolVersion: protocolVersion,
				Payload: &packetspb.Envelope_ServerEvent{
					ServerEvent: evt,
				},
			}

			select {
			case outboundCh <- outboundMsg{env: env}:
				metrics.WsServerEventsSentTotal.Inc()
				s.log.Debug("ws fanout: delivered event",
					zap.String("session_id", sessionID),
					zap.String("user_id", userID),
					zap.Int64("event_seq", evt.GetEventSeq()),
					zap.String("event_type", evt.GetEventType().String()),
				)
			default:
				// outboundCh is full — send overflow error then close.
				metrics.WsOutboundOverflowTotal.Inc()
				s.log.Warn("ws fanout: outbound queue overflow, closing session",
					zap.String("session_id", sessionID),
					zap.String("user_id", userID),
					zap.Int("queue_max", queueMax),
				)
				// Best-effort: try to enqueue the backpressure error frame.
				select {
				case outboundCh <- outboundMsg{env: s.buildErrorEnvelope("", "", packetspb.ErrorCode_ERROR_CODE_BACKPRESSURE_OVERFLOW, "outbound queue overflow", 0)}:
				default:
				}
				// Close the underlying connection so the reader loop breaks.
				_ = conn.Close()
				return
			}
		}
	}()

	return unsubscribe, done
}

// buildErrorEnvelope constructs an error Envelope without writing to the conn.
func (s *Server) buildErrorEnvelope(
	requestID string,
	traceID string,
	code packetspb.ErrorCode,
	message string,
	retryAfterMs uint32,
) *packetspb.Envelope {
	return &packetspb.Envelope{
		RequestId:       requestID,
		TraceId:         traceID,
		ProtocolVersion: protocolVersion,
		Payload: &packetspb.Envelope_Error{
			Error: &packetspb.Error{
				Code:         code,
				Message:      message,
				RetryAfterMs: retryAfterMs,
			},
		},
	}
}

func (s *Server) writeEnvelope(conn net.Conn, env *packetspb.Envelope) error {
	body, err := proto.Marshal(env)
	if err != nil {
		return err
	}
	if err := wsutil.WriteServerMessage(conn, ws.OpBinary, body); err != nil {
		return err
	}
	metrics.MessagesSent.Inc()
	return nil
}

func (s *Server) registerUserSession(userID string, outboundCh chan outboundMsg) func() {
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	if s.sessionsByUser[userID] == nil {
		s.sessionsByUser[userID] = make(map[chan outboundMsg]*sessionState)
	}
	s.sessionsByUser[userID][outboundCh] = &sessionState{windowActive: true}
	return func() {
		s.sessionMu.Lock()
		defer s.sessionMu.Unlock()
		sessions := s.sessionsByUser[userID]
		delete(sessions, outboundCh)
		if len(sessions) == 0 {
			delete(s.sessionsByUser, userID)
		}
	}
}

func (s *Server) setSessionWindowActive(userID string, outboundCh chan outboundMsg, active bool) {
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	sessions := s.sessionsByUser[userID]
	if sessions == nil {
		return
	}
	state, ok := sessions[outboundCh]
	if !ok || state == nil {
		return
	}
	state.windowActive = active
}

// SetPushNotifier configures the optional push notifier. Must be called
// before the server starts accepting connections.
func (s *Server) SetPushNotifier(pn PushNotifier) {
	s.pushNotifier = pn
}

// HasActiveSessions returns true if the given user has at least one
// authenticated WebSocket session connected right now.
func (s *Server) HasActiveSessions(userID string) bool {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	return len(s.sessionsByUser[userID]) > 0
}

// HasActiveWindowSessions returns true if at least one authenticated websocket
// session for the user reports its chat window as active (focused + visible).
func (s *Server) HasActiveWindowSessions(userID string) bool {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	for _, state := range s.sessionsByUser[userID] {
		if state != nil && state.windowActive {
			return true
		}
	}
	return false
}

func (s *Server) sendDirectEnvelope(userIDs []string, env *packetspb.Envelope) {
	s.sessionMu.RLock()
	targets := make([]chan outboundMsg, 0)
	for _, userID := range userIDs {
		for ch := range s.sessionsByUser[userID] {
			targets = append(targets, ch)
		}
	}
	s.sessionMu.RUnlock()

	for _, ch := range targets {
		select {
		case ch <- outboundMsg{env: env}:
		default:
		}
	}
}

func (s *Server) sendDirectServerEvents(deliveries []chat.DirectDelivery) {
	var offlineDeliveries []chat.DirectDelivery
	for _, delivery := range deliveries {
		if delivery.UserID == "" || delivery.Event == nil {
			continue
		}
		s.sendDirectEnvelope([]string{delivery.UserID}, &packetspb.Envelope{
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_ServerEvent{
				ServerEvent: delivery.Event,
			},
		})
		if s.pushNotifier != nil && !s.HasActiveSessions(delivery.UserID) {
			offlineDeliveries = append(offlineDeliveries, delivery)
		}
	}
	if len(offlineDeliveries) > 0 {
		go s.pushNotifier.PushChatDeliveries(offlineDeliveries)
	}
}

func (s *Server) sendDirectCallServerEvents(deliveries []calls.DirectDelivery) {
	var offlineDeliveries []calls.DirectDelivery
	for _, delivery := range deliveries {
		if delivery.UserID == "" || delivery.Event == nil {
			continue
		}
		s.sendDirectEnvelope([]string{delivery.UserID}, &packetspb.Envelope{
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_ServerEvent{
				ServerEvent: delivery.Event,
			},
		})
		if s.pushNotifier != nil && !s.HasActiveSessions(delivery.UserID) {
			offlineDeliveries = append(offlineDeliveries, delivery)
		}
	}
	if len(offlineDeliveries) > 0 {
		go s.pushNotifier.PushCallDeliveries(offlineDeliveries)
	}
}

// SendCallDirectServerEvents pushes direct, non-sequenced call events to active sessions.
func (s *Server) SendCallDirectServerEvents(deliveries []calls.DirectDelivery) {
	s.sendDirectCallServerEvents(deliveries)
}

// SendChatDirectServerEvents pushes direct, non-sequenced chat events to active sessions.
// Used by the chat HTTP handler to deliver conversation_upserted events after DM creation.
func (s *Server) SendChatDirectServerEvents(deliveries []chat.DirectDelivery) {
	s.sendDirectServerEvents(deliveries)
}

// SendForcePasswordChange pushes a force_password_change event directly to all
// active sessions of the given user. The event carries no sequence number and
// is not persisted to the event log.
func (s *Server) SendForcePasswordChange(userID string) {
	evt := &packetspb.ServerEvent{
		EventType: packetspb.EventType_EVENT_TYPE_FORCE_PASSWORD_CHANGE,
		Payload: &packetspb.ServerEvent_ForcePasswordChange{
			ForcePasswordChange: &packetspb.ForcePasswordChangeEvent{
				UserId: userID,
			},
		},
	}
	s.sendDirectEnvelope([]string{userID}, &packetspb.Envelope{
		ProtocolVersion: protocolVersion,
		Payload:         &packetspb.Envelope_ServerEvent{ServerEvent: evt},
	})
}

func (s *Server) sharedUserIDs(ctx context.Context, userID uuid.UUID) ([]string, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT DISTINCT cm_other.user_id
		  FROM channel_members cm_self
		  JOIN channel_members cm_other
		    ON cm_other.channel_id = cm_self.channel_id
		   AND cm_other.is_archived = false
		 WHERE cm_self.user_id = $1
		   AND cm_self.is_archived = false`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recipients := make([]string, 0)
	for rows.Next() {
		var recipient uuid.UUID
		if err := rows.Scan(&recipient); err != nil {
			return nil, err
		}
		recipients = append(recipients, recipient.String())
	}
	return recipients, rows.Err()
}

func (s *Server) conversationMemberIDs(ctx context.Context, conversationID, excludeUserID uuid.UUID) ([]string, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT user_id
		  FROM channel_members
		 WHERE channel_id = $1
		   AND is_archived = false
		   AND user_id <> $2`,
		conversationID, excludeUserID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recipients := make([]string, 0)
	for rows.Next() {
		var recipient uuid.UUID
		if err := rows.Scan(&recipient); err != nil {
			return nil, err
		}
		recipients = append(recipients, recipient.String())
	}
	return recipients, rows.Err()
}

func (s *Server) setPresenceState(ctx context.Context, userID uuid.UUID, status packetspb.PresenceStatus) error {
	if _, err := s.db.Pool.Exec(ctx, `
		INSERT INTO user_presence (user_id, status, last_active_at, updated_at)
		VALUES ($1, $2, now(), now())
		ON CONFLICT (user_id) DO UPDATE
		    SET status = EXCLUDED.status,
		        last_active_at = now(),
		        updated_at = now()`,
		userID, presenceStatusToDB(status),
	); err != nil {
		return err
	}
	return nil
}

func (s *Server) broadcastPresence(ctx context.Context, userID uuid.UUID, status packetspb.PresenceStatus) {
	recipients, err := s.sharedUserIDs(ctx, userID)
	if err != nil {
		s.log.Error("ws: sharedUserIDs presence error", zap.Error(err))
		return
	}
	env := &packetspb.Envelope{
		ProtocolVersion: protocolVersion,
		Payload: &packetspb.Envelope_PresenceEvent{
			PresenceEvent: &packetspb.PresenceEvent{
				UserId:            userID.String(),
				EffectivePresence: status,
			},
		},
	}
	s.sendDirectEnvelope(recipients, env)
}

func (s *Server) handleTypingRequest(ctx context.Context, principal auth.Principal, req *packetspb.TypingRequest, badReq func(string), forbidden func(string)) {
	conversationID, err := uuid.Parse(req.GetConversationId())
	if err != nil {
		badReq("typing_request: invalid conversation_id")
		return
	}
	var isMember bool
	if err := s.db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			  FROM channel_members
			 WHERE channel_id = $1
			   AND user_id = $2
			   AND is_archived = false
		)`,
		conversationID, principal.UserID,
	).Scan(&isMember); err != nil {
		badReq("typing_request: membership check failed")
		return
	}
	if !isMember {
		forbidden("not a member of this channel")
		return
	}

	recipients, err := s.conversationMemberIDs(ctx, conversationID, principal.UserID)
	if err != nil {
		badReq("typing_request: member lookup failed")
		return
	}

	env := &packetspb.Envelope{
		ProtocolVersion: protocolVersion,
		Payload: &packetspb.Envelope_TypingEvent{
			TypingEvent: &packetspb.TypingEvent{
				ConversationId:      req.GetConversationId(),
				UserId:              principal.UserID.String(),
				ThreadRootMessageId: req.GetThreadRootMessageId(),
				IsTyping:            req.GetIsTyping(),
			},
		},
	}

	if req.GetIsTyping() {
		expiresAt := time.Now().Add(5 * time.Second)
		env.GetTypingEvent().ExpiresAt = timestamppb.New(expiresAt)
		key := fmt.Sprintf("%s|%s|%s", req.GetConversationId(), req.GetThreadRootMessageId(), principal.UserID.String())
		s.typingMu.Lock()
		s.typingExpiry[key] = expiresAt
		s.typingMu.Unlock()

		go s.expireTyping(key, req.GetConversationId(), req.GetThreadRootMessageId(), principal.UserID, expiresAt)
	} else {
		s.clearTyping(req.GetConversationId(), req.GetThreadRootMessageId(), principal.UserID)
	}

	s.sendDirectEnvelope(recipients, env)
}

func (s *Server) clearTyping(conversationID, threadRootMessageID string, userID uuid.UUID) {
	key := fmt.Sprintf("%s|%s|%s", conversationID, threadRootMessageID, userID.String())
	s.typingMu.Lock()
	delete(s.typingExpiry, key)
	s.typingMu.Unlock()
}

func (s *Server) expireTyping(key string, conversationIDText, threadRootMessageID string, userID uuid.UUID, expiresAt time.Time) {
	timer := time.NewTimer(time.Until(expiresAt))
	defer timer.Stop()
	<-timer.C

	s.typingMu.Lock()
	current, ok := s.typingExpiry[key]
	if !ok || !current.Equal(expiresAt) {
		s.typingMu.Unlock()
		return
	}
	delete(s.typingExpiry, key)
	s.typingMu.Unlock()

	conversationID, err := uuid.Parse(conversationIDText)
	if err != nil {
		return
	}
	recipients, err := s.conversationMemberIDs(context.Background(), conversationID, userID)
	if err != nil {
		return
	}

	env := &packetspb.Envelope{
		ProtocolVersion: protocolVersion,
		Payload: &packetspb.Envelope_TypingEvent{
			TypingEvent: &packetspb.TypingEvent{
				ConversationId:      conversationIDText,
				UserId:              userID.String(),
				ThreadRootMessageId: threadRootMessageID,
				IsTyping:            false,
			},
		},
	}
	s.sendDirectEnvelope(recipients, env)
}

func presenceStatusToDB(status packetspb.PresenceStatus) string {
	switch status {
	case packetspb.PresenceStatus_PRESENCE_STATUS_ONLINE:
		return "online"
	case packetspb.PresenceStatus_PRESENCE_STATUS_AWAY:
		return "away"
	default:
		return "offline"
	}
}

func mapWorkspaceRole(raw string) packetspb.WorkspaceRole {
	switch raw {
	case "owner":
		return packetspb.WorkspaceRole_WORKSPACE_ROLE_OWNER
	case "admin":
		return packetspb.WorkspaceRole_WORKSPACE_ROLE_ADMIN
	case "member":
		return packetspb.WorkspaceRole_WORKSPACE_ROLE_MEMBER
	default:
		return packetspb.WorkspaceRole_WORKSPACE_ROLE_UNSPECIFIED
	}
}

// handleDomainPayload dispatches authenticated domain payloads (State 3).
func (s *Server) handleDomainPayload(
	ctx context.Context,
	env *packetspb.Envelope,
	principal auth.Principal,
	outboundCh chan outboundMsg,
	enqueue func(*packetspb.Envelope) bool,
) {
	reqID := env.GetRequestId()
	traceID := env.GetTraceId()

	badReq := func(msg string) {
		enqueue(s.buildErrorEnvelope(reqID, traceID, packetspb.ErrorCode_ERROR_CODE_BAD_REQUEST, msg, 0))
	}
	forbidden := func(msg string) {
		enqueue(s.buildErrorEnvelope(reqID, traceID, packetspb.ErrorCode_ERROR_CODE_FORBIDDEN, msg, 0))
	}

	switch p := env.GetPayload().(type) {
	case *packetspb.Envelope_BootstrapRequest:
		req := p.BootstrapRequest
		if req == nil || s.bootstrapSvc == nil {
			badReq("bootstrap_request: missing payload")
			return
		}
		resp, err := s.bootstrapSvc.Bootstrap(ctx, principal, req)
		if err != nil {
			switch {
			case errors.Is(err, bootstrap.ErrSessionExpired):
				enqueue(s.buildErrorEnvelope(reqID, traceID, packetspb.ErrorCode_ERROR_CODE_BOOTSTRAP_EXPIRED, "bootstrap session expired", 0))
			case errors.Is(err, bootstrap.ErrInvalidRequest), errors.Is(err, bootstrap.ErrInvalidPageToken), errors.Is(err, bootstrap.ErrSessionMismatch):
				badReq("bootstrap_request: invalid session or page token")
			default:
				s.log.Error("ws: Bootstrap error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
				badReq("bootstrap_request: internal error")
			}
			return
		}
		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_BootstrapResponse{
				BootstrapResponse: resp,
			},
		})

	case *packetspb.Envelope_SyncSinceRequest:
		req := p.SyncSinceRequest
		if req == nil || s.syncSvc == nil {
			badReq("sync_since_request: missing payload")
			return
		}
		resp, err := s.syncSvc.SyncSince(ctx, principal, req)
		if err != nil {
			s.log.Error("ws: SyncSince error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
			badReq("sync_since_request: internal error")
			return
		}
		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_SyncSinceResponse{
				SyncSinceResponse: resp,
			},
		})

	case *packetspb.Envelope_AckRequest:
		req := p.AckRequest
		if req == nil || s.syncSvc == nil {
			badReq("ack_request: missing payload")
			return
		}
		resp, err := s.syncSvc.Ack(ctx, principal, req)
		if err != nil {
			badReq("ack_request: invalid last_applied_event_seq")
			return
		}
		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_AckResponse{
				AckResponse: resp,
			},
		})

	case *packetspb.Envelope_SendMessageRequest:
		req := p.SendMessageRequest
		if req == nil {
			badReq("send_message_request: missing payload")
			return
		}
		channelID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("send_message_request: invalid conversation_id")
			return
		}
		var threadRootID uuid.UUID
		if req.GetThreadRootMessageId() != "" {
			if threadRootID, err = uuid.Parse(req.GetThreadRootMessageId()); err != nil {
				badReq("send_message_request: invalid thread_root_message_id")
				return
			}
		}
		attachmentIDs := make([]uuid.UUID, 0, len(req.GetAttachmentIds()))
		for _, rawID := range req.GetAttachmentIds() {
			attachmentID, err := uuid.Parse(rawID)
			if err != nil {
				badReq("send_message_request: invalid attachment_ids")
				return
			}
			attachmentIDs = append(attachmentIDs, attachmentID)
		}

		result, err := s.chatSvc.SendMessage(ctx, chat.SendMessageParams{
			ChannelID:           channelID,
			SenderID:            principal.UserID,
			ClientMsgID:         req.GetClientMsgId(),
			Body:                req.GetBody(),
			ThreadRootMessageID: threadRootID,
			AttachmentIDs:       attachmentIDs,
		})
		if err != nil {
			if errors.Is(err, chat.ErrNotMember) {
				forbidden("not a member of this channel")
				return
			}
			if errors.Is(err, chat.ErrMessageNotFound) || errors.Is(err, chat.ErrInvalidThread) {
				badReq("send_message_request: invalid thread root message")
				return
			}
			if errors.Is(err, chat.ErrAttachmentNotFound) ||
				errors.Is(err, chat.ErrAttachmentNotStaged) ||
				errors.Is(err, chat.ErrAttachmentOwnership) ||
				errors.Is(err, chat.ErrInvalidAttachment) ||
				errors.Is(err, chat.ErrEmptyMessage) {
				badReq("send_message_request: invalid attachments or body")
				return
			}
			s.log.Error("ws: SendMessage error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
			badReq("send_message_request: internal error")
			return
		}

		resp := &packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_SendMessageAck{
				SendMessageAck: &packetspb.SendMessageAck{
					ConversationId: req.GetConversationId(),
					MessageId:      result.MessageID.String(),
					ChannelSeq:     result.ChannelSeq,
					CreatedAt:      result.CreatedAt,
					ClientMsgId:    result.ClientMsgID,
					Deduped:        result.Deduped,
				},
			},
		}
		enqueue(resp)
		s.sendDirectServerEvents(result.DirectDeliveries)

	case *packetspb.Envelope_CreateCallRequest:
		req := p.CreateCallRequest
		if req == nil || s.callSvc == nil {
			badReq("create_call_request: missing payload")
			return
		}
		conversationID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("create_call_request: invalid conversation_id")
			return
		}
		inviteeIDs := make([]uuid.UUID, 0, len(req.GetInviteeUserIds()))
		for _, raw := range req.GetInviteeUserIds() {
			inviteeID, err := uuid.Parse(raw)
			if err != nil {
				badReq("create_call_request: invalid invitee_user_ids")
				return
			}
			inviteeIDs = append(inviteeIDs, inviteeID)
		}

		result, err := s.callSvc.CreateCall(ctx, calls.CreateCallParams{
			ConversationID: conversationID,
			InitiatorID:    principal.UserID,
			InitiatorRole:  principal.Role,
			InviteeUserIDs: inviteeIDs,
		})
		if err != nil {
			switch {
			case errors.Is(err, calls.ErrNotMember):
				forbidden("not a member of this conversation")
			case errors.Is(err, calls.ErrCallAlreadyActive):
				enqueue(s.buildErrorEnvelope(reqID, traceID, packetspb.ErrorCode_ERROR_CODE_CALL_ALREADY_ACTIVE, "call already active", 0))
			case errors.Is(err, calls.ErrBadRequest):
				badReq("create_call_request: invalid request")
			default:
				s.log.Error("ws: CreateCall error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
				badReq("create_call_request: internal error")
			}
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_CreateCallResponse{
				CreateCallResponse: &packetspb.CreateCallResponse{
					CallId:         result.CallID.String(),
					ConversationId: result.ConversationID.String(),
					Status:         result.Status,
				},
			},
		})
		s.sendDirectCallServerEvents(result.DirectDeliveries)

	case *packetspb.Envelope_InviteCallMembersRequest:
		req := p.InviteCallMembersRequest
		if req == nil || s.callSvc == nil {
			badReq("invite_call_members_request: missing payload")
			return
		}
		conversationID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("invite_call_members_request: invalid conversation_id")
			return
		}
		inviteeIDs := make([]uuid.UUID, 0, len(req.GetInviteeUserIds()))
		for _, raw := range req.GetInviteeUserIds() {
			inviteeID, err := uuid.Parse(raw)
			if err != nil {
				badReq("invite_call_members_request: invalid invitee_user_ids")
				return
			}
			inviteeIDs = append(inviteeIDs, inviteeID)
		}

		result, err := s.callSvc.InviteCallMembers(ctx, calls.InviteCallMembersParams{
			ConversationID: conversationID,
			ActorID:        principal.UserID,
			ActorRole:      principal.Role,
			InviteeUserIDs: inviteeIDs,
		})
		if err != nil {
			switch {
			case errors.Is(err, calls.ErrNotMember):
				forbidden("not a member of this conversation")
			case errors.Is(err, calls.ErrForbiddenAction):
				forbidden("forbidden call action")
			case errors.Is(err, calls.ErrCallNotActive):
				enqueue(s.buildErrorEnvelope(reqID, traceID, packetspb.ErrorCode_ERROR_CODE_CALL_NOT_ACTIVE, "call is not active", 0))
			case errors.Is(err, calls.ErrBadRequest):
				badReq("invite_call_members_request: invalid request")
			default:
				s.log.Error("ws: InviteCallMembers error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
				badReq("invite_call_members_request: internal error")
			}
			return
		}

		invitedUserIDs := make([]string, 0, len(result.InvitedUserIDs))
		for _, id := range result.InvitedUserIDs {
			invitedUserIDs = append(invitedUserIDs, id.String())
		}
		skippedUserIDs := make([]string, 0, len(result.SkippedUserIDs))
		for _, id := range result.SkippedUserIDs {
			skippedUserIDs = append(skippedUserIDs, id.String())
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_InviteCallMembersResponse{
				InviteCallMembersResponse: &packetspb.InviteCallMembersResponse{
					CallId:         result.CallID.String(),
					ConversationId: result.ConversationID.String(),
					InvitedUserIds: invitedUserIDs,
					SkippedUserIds: skippedUserIDs,
				},
			},
		})
		s.sendDirectCallServerEvents(result.DirectDeliveries)

	case *packetspb.Envelope_JoinCallTokenRequest:
		req := p.JoinCallTokenRequest
		if req == nil || s.callSvc == nil {
			badReq("join_call_token_request: missing payload")
			return
		}
		conversationID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("join_call_token_request: invalid conversation_id")
			return
		}

		result, err := s.callSvc.JoinCallToken(ctx, calls.JoinCallTokenParams{
			ConversationID: conversationID,
			UserID:         principal.UserID,
		})
		if err != nil {
			switch {
			case errors.Is(err, calls.ErrNotMember):
				forbidden("not a member of this conversation")
			case errors.Is(err, calls.ErrCallNotActive):
				badReq("join_call_token_request: call is not active")
			case errors.Is(err, calls.ErrBadRequest):
				badReq("join_call_token_request: invalid request")
			default:
				s.log.Error("ws: JoinCallToken error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
				badReq("join_call_token_request: internal error")
			}
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_JoinCallTokenResponse{
				JoinCallTokenResponse: &packetspb.JoinCallTokenResponse{
					LivekitUrl:   result.LiveKitURL,
					LivekitToken: result.LiveKitToken,
					LivekitRoom:  result.LiveKitRoom,
				},
			},
		})

	case *packetspb.Envelope_AcceptCallInviteRequest:
		req := p.AcceptCallInviteRequest
		if req == nil || s.callSvc == nil {
			badReq("accept_call_invite_request: missing payload")
			return
		}
		inviteID, err := uuid.Parse(req.GetInviteId())
		if err != nil {
			badReq("accept_call_invite_request: invalid invite_id")
			return
		}

		result, err := s.callSvc.AcceptInvite(ctx, calls.InviteActionParams{
			InviteID:  inviteID,
			ActorID:   principal.UserID,
			ActorRole: principal.Role,
		})
		if err != nil {
			switch {
			case errors.Is(err, calls.ErrInviteNotActive):
				enqueue(s.buildErrorEnvelope(reqID, traceID, packetspb.ErrorCode_ERROR_CODE_INVITE_NOT_ACTIVE, "invite is not active", 0))
			case errors.Is(err, calls.ErrForbiddenAction):
				forbidden("forbidden invite action")
			case errors.Is(err, calls.ErrBadRequest), errors.Is(err, calls.ErrInviteNotFound):
				badReq("accept_call_invite_request: invalid invite")
			default:
				s.log.Error("ws: AcceptInvite error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
				badReq("accept_call_invite_request: internal error")
			}
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_CallInviteActionAck{
				CallInviteActionAck: &packetspb.CallInviteActionAck{
					Ok:             true,
					InviteId:       result.InviteID.String(),
					ResultingState: result.ResultingState,
					Applied:        result.Applied,
				},
			},
		})
		s.sendDirectCallServerEvents(result.DirectDeliveries)

	case *packetspb.Envelope_RejectCallInviteRequest:
		req := p.RejectCallInviteRequest
		if req == nil || s.callSvc == nil {
			badReq("reject_call_invite_request: missing payload")
			return
		}
		inviteID, err := uuid.Parse(req.GetInviteId())
		if err != nil {
			badReq("reject_call_invite_request: invalid invite_id")
			return
		}

		result, err := s.callSvc.RejectInvite(ctx, calls.InviteActionParams{
			InviteID:  inviteID,
			ActorID:   principal.UserID,
			ActorRole: principal.Role,
		})
		if err != nil {
			switch {
			case errors.Is(err, calls.ErrInviteNotActive):
				enqueue(s.buildErrorEnvelope(reqID, traceID, packetspb.ErrorCode_ERROR_CODE_INVITE_NOT_ACTIVE, "invite is not active", 0))
			case errors.Is(err, calls.ErrForbiddenAction):
				forbidden("forbidden invite action")
			case errors.Is(err, calls.ErrBadRequest), errors.Is(err, calls.ErrInviteNotFound):
				badReq("reject_call_invite_request: invalid invite")
			default:
				s.log.Error("ws: RejectInvite error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
				badReq("reject_call_invite_request: internal error")
			}
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_CallInviteActionAck{
				CallInviteActionAck: &packetspb.CallInviteActionAck{
					Ok:             true,
					InviteId:       result.InviteID.String(),
					ResultingState: result.ResultingState,
					Applied:        result.Applied,
				},
			},
		})
		s.sendDirectCallServerEvents(result.DirectDeliveries)

	case *packetspb.Envelope_CancelCallInviteRequest:
		req := p.CancelCallInviteRequest
		if req == nil || s.callSvc == nil {
			badReq("cancel_call_invite_request: missing payload")
			return
		}
		inviteID, err := uuid.Parse(req.GetInviteId())
		if err != nil {
			badReq("cancel_call_invite_request: invalid invite_id")
			return
		}

		result, err := s.callSvc.CancelInvite(ctx, calls.InviteActionParams{
			InviteID:  inviteID,
			ActorID:   principal.UserID,
			ActorRole: principal.Role,
		})
		if err != nil {
			switch {
			case errors.Is(err, calls.ErrForbiddenAction):
				forbidden("forbidden invite action")
			case errors.Is(err, calls.ErrBadRequest), errors.Is(err, calls.ErrInviteNotFound):
				badReq("cancel_call_invite_request: invalid invite")
			default:
				s.log.Error("ws: CancelInvite error", zap.Error(err), zap.String("user_id", principal.UserID.String()))
				badReq("cancel_call_invite_request: internal error")
			}
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_CallInviteActionAck{
				CallInviteActionAck: &packetspb.CallInviteActionAck{
					Ok:             true,
					InviteId:       result.InviteID.String(),
					ResultingState: result.ResultingState,
					Applied:        result.Applied,
				},
			},
		})
		s.sendDirectCallServerEvents(result.DirectDeliveries)

	case *packetspb.Envelope_UpdateReadCursorRequest:
		req := p.UpdateReadCursorRequest
		if req == nil {
			badReq("update_read_cursor_request: missing payload")
			return
		}
		channelID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("update_read_cursor_request: invalid conversation_id")
			return
		}

		result, err := s.chatSvc.UpdateReadCursor(ctx, chat.UpdateReadCursorParams{
			ChannelID:   channelID,
			UserID:      principal.UserID,
			LastReadSeq: req.GetLastReadSeq(),
		})
		if err != nil {
			if errors.Is(err, chat.ErrNotMember) {
				forbidden("not a member of this channel")
				return
			}
			s.log.Error("ws: UpdateReadCursor error", zap.Error(err))
			badReq("update_read_cursor_request: internal error")
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_ReadCursorAck{
				ReadCursorAck: &packetspb.ReadCursorAck{
					ConversationId: result.ChannelID.String(),
					LastReadSeq:    result.LastReadSeq,
				},
			},
		})
		s.sendDirectServerEvents(result.DirectDeliveries)

	case *packetspb.Envelope_SetPresenceRequest:
		req := p.SetPresenceRequest
		if req == nil {
			badReq("set_presence_request: missing payload")
			return
		}
		if req.GetDesiredPresence() != packetspb.PresenceStatus_PRESENCE_STATUS_ONLINE &&
			req.GetDesiredPresence() != packetspb.PresenceStatus_PRESENCE_STATUS_AWAY {
			badReq("set_presence_request: invalid desired_presence")
			return
		}
		if err := s.setPresenceState(ctx, principal.UserID, req.GetDesiredPresence()); err != nil {
			s.log.Error("ws: SetPresence error", zap.Error(err))
			badReq("set_presence_request: internal error")
			return
		}
		s.broadcastPresence(ctx, principal.UserID, req.GetDesiredPresence())

	case *packetspb.Envelope_SetClientWindowActivityRequest:
		req := p.SetClientWindowActivityRequest
		if req == nil {
			badReq("set_client_window_activity_request: missing payload")
			return
		}
		s.setSessionWindowActive(principal.UserID.String(), outboundCh, req.GetIsActive())

	case *packetspb.Envelope_TypingRequest:
		req := p.TypingRequest
		if req == nil {
			badReq("typing_request: missing payload")
			return
		}
		s.handleTypingRequest(ctx, principal, req, badReq, forbidden)

	case *packetspb.Envelope_AddReactionRequest:
		req := p.AddReactionRequest
		if req == nil {
			badReq("add_reaction_request: missing payload")
			return
		}
		channelID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("add_reaction_request: invalid conversation_id")
			return
		}
		msgID, err := uuid.Parse(req.GetMessageId())
		if err != nil {
			badReq("add_reaction_request: invalid message_id")
			return
		}

		result, err := s.chatSvc.AddReaction(ctx, chat.ReactionParams{
			ChannelID:  channelID,
			MessageID:  msgID,
			UserID:     principal.UserID,
			Emoji:      req.GetEmoji(),
			ClientOpID: req.GetClientOpId(),
		})
		if err != nil {
			if errors.Is(err, chat.ErrNotMember) {
				forbidden("not a member of this channel")
				return
			}
			if errors.Is(err, chat.ErrMessageNotFound) {
				badReq("add_reaction_request: message not found")
				return
			}
			s.log.Error("ws: AddReaction error", zap.Error(err))
			badReq("add_reaction_request: internal error")
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_ReactionAck{
				ReactionAck: &packetspb.ReactionAck{
					Ok:         result.OK,
					MessageId:  result.MessageID.String(),
					Emoji:      result.Emoji,
					ClientOpId: result.ClientOpID,
					Applied:    result.Applied,
				},
			},
		})

	case *packetspb.Envelope_RemoveReactionRequest:
		req := p.RemoveReactionRequest
		if req == nil {
			badReq("remove_reaction_request: missing payload")
			return
		}
		channelID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("remove_reaction_request: invalid conversation_id")
			return
		}
		msgID, err := uuid.Parse(req.GetMessageId())
		if err != nil {
			badReq("remove_reaction_request: invalid message_id")
			return
		}

		result, err := s.chatSvc.RemoveReaction(ctx, chat.ReactionParams{
			ChannelID:  channelID,
			MessageID:  msgID,
			UserID:     principal.UserID,
			Emoji:      req.GetEmoji(),
			ClientOpID: req.GetClientOpId(),
		})
		if err != nil {
			if errors.Is(err, chat.ErrNotMember) {
				forbidden("not a member of this channel")
				return
			}
			if errors.Is(err, chat.ErrMessageNotFound) {
				badReq("remove_reaction_request: message not found")
				return
			}
			s.log.Error("ws: RemoveReaction error", zap.Error(err))
			badReq("remove_reaction_request: internal error")
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_ReactionAck{
				ReactionAck: &packetspb.ReactionAck{
					Ok:         result.OK,
					MessageId:  result.MessageID.String(),
					Emoji:      result.Emoji,
					ClientOpId: result.ClientOpID,
					Applied:    result.Applied,
				},
			},
		})

	case *packetspb.Envelope_SubscribeThreadRequest:
		req := p.SubscribeThreadRequest
		if req == nil {
			badReq("subscribe_thread_request: missing payload")
			return
		}
		channelID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("subscribe_thread_request: invalid conversation_id")
			return
		}
		threadRootID, err := uuid.Parse(req.GetThreadRootMessageId())
		if err != nil {
			badReq("subscribe_thread_request: invalid thread_root_message_id")
			return
		}

		result, err := s.chatSvc.SubscribeThread(ctx, chat.SubscribeThreadParams{
			ChannelID:           channelID,
			ThreadRootMessageID: threadRootID,
			RequesterID:         principal.UserID,
			LastThreadSeq:       req.GetLastThreadSeq(),
		})
		if err != nil {
			if errors.Is(err, chat.ErrNotMember) {
				forbidden("not a member of this channel")
				return
			}
			if errors.Is(err, chat.ErrMessageNotFound) || errors.Is(err, chat.ErrInvalidThread) {
				badReq("subscribe_thread_request: invalid thread root message")
				return
			}
			s.log.Error("ws: SubscribeThread error", zap.Error(err))
			badReq("subscribe_thread_request: internal error")
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_SubscribeThreadResponse{
				SubscribeThreadResponse: &packetspb.SubscribeThreadResponse{
					ConversationId:      req.GetConversationId(),
					ThreadRootMessageId: req.GetThreadRootMessageId(),
					CurrentThreadSeq:    result.CurrentThreadSeq,
					Replay:              result.Replay,
				},
			},
		})
		s.sendDirectServerEvents(result.DirectDeliveries)

	case *packetspb.Envelope_SetNotificationLevelRequest:
		req := p.SetNotificationLevelRequest
		if req == nil {
			badReq("set_notification_level_request: missing payload")
			return
		}
		channelID, err := uuid.Parse(req.GetConversationId())
		if err != nil {
			badReq("set_notification_level_request: invalid conversation_id")
			return
		}

		result, err := s.chatSvc.SetNotificationLevel(ctx, chat.SetNotificationLevelParams{
			ChannelID: channelID,
			UserID:    principal.UserID,
			Level:     req.GetLevel(),
		})
		if err != nil {
			if errors.Is(err, chat.ErrNotMember) {
				forbidden("not a member of this channel")
				return
			}
			if errors.Is(err, chat.ErrInvalidNotificationLevel) {
				badReq("set_notification_level_request: level must be 0, 1, or 2")
				return
			}
			s.log.Error("ws: SetNotificationLevel error", zap.Error(err))
			badReq("set_notification_level_request: internal error")
			return
		}

		enqueue(&packetspb.Envelope{
			RequestId:       reqID,
			TraceId:         traceID,
			ProtocolVersion: protocolVersion,
			Payload: &packetspb.Envelope_SetNotificationLevelResponse{
				SetNotificationLevelResponse: &packetspb.SetNotificationLevelResponse{
					Level: result.Level,
				},
			},
		})
		s.sendDirectServerEvents(result.DirectDeliveries)

	default:
		enqueue(s.buildErrorEnvelope(reqID, traceID, packetspb.ErrorCode_ERROR_CODE_BAD_REQUEST, "unsupported payload type", 0))
	}
}

func negotiateCapabilities(clientCaps []packetspb.FeatureCapability) []packetspb.FeatureCapability {
	accepted := make([]packetspb.FeatureCapability, 0, len(clientCaps))
	for _, cap := range clientCaps {
		if _, ok := supportedCapabilities[cap]; ok {
			accepted = append(accepted, cap)
		}
	}
	return accepted
}
