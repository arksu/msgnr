package push

import (
	"encoding/json"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"msgnr/internal/auth"
	"msgnr/internal/logger"
)

// Handler serves the push notification HTTP endpoints.
type Handler struct {
	svc     *Service
	authSvc *auth.Service
	log     *zap.Logger
}

// NewHandler creates a push HTTP handler.
func NewHandler(svc *Service, authSvc *auth.Service) *Handler {
	return &Handler{
		svc:     svc,
		authSvc: authSvc,
		log:     logger.Logger.Named("push.handler"),
	}
}

// RegisterRoutes registers push-related HTTP routes on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/push/vapid-key", h.requireAuth(h.vapidKey))
	mux.HandleFunc("/api/push/subscribe", h.requireAuth(h.subscribe))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type authHandler func(w http.ResponseWriter, r *http.Request, p auth.Principal)

func (h *Handler) vapidKey(w http.ResponseWriter, r *http.Request, _ auth.Principal) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if !h.svc.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, errBody("push notifications are not configured"))
		return
	}
	writeJSON(w, http.StatusOK, VAPIDKeyResponse{PublicKey: h.svc.cfg.VAPIDPublicKey})
}

func (h *Handler) subscribe(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	switch r.Method {
	case http.MethodPost:
		h.handleSubscribe(w, r, p)
	case http.MethodDelete:
		h.handleUnsubscribe(w, r, p)
	default:
		methodNotAllowed(w)
	}
}

func (h *Handler) handleSubscribe(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	if !h.svc.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, errBody("push notifications are not configured"))
		return
	}

	var req SubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
		return
	}

	if err := h.svc.Subscribe(r.Context(), p.UserID, req); err != nil {
		h.log.Error("failed to subscribe", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, errBody("failed to save subscription"))
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "subscribed"})
}

func (h *Handler) handleUnsubscribe(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	var req UnsubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
		return
	}

	if req.Endpoint == "" {
		writeJSON(w, http.StatusBadRequest, errBody("endpoint is required"))
		return
	}

	if err := h.svc.Unsubscribe(r.Context(), p.UserID, req.Endpoint); err != nil {
		h.log.Error("failed to unsubscribe", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, errBody("failed to remove subscription"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "unsubscribed"})
}

// ---------------------------------------------------------------------------
// Auth middleware (same pattern as other handlers in the codebase)
// ---------------------------------------------------------------------------

func (h *Handler) requireAuth(next authHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, errBody("missing token"))
			return
		}
		principal, err := h.authSvc.VerifyAccess(r.Context(), token)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, errBody("invalid or expired token"))
			return
		}
		next(w, r, principal)
	}
}

// ---------------------------------------------------------------------------
// Helpers (package-local, matching other handler files)
// ---------------------------------------------------------------------------

func bearerToken(r *http.Request) string {
	v := r.Header.Get("Authorization")
	if after, ok := strings.CutPrefix(v, "Bearer "); ok {
		return strings.TrimSpace(after)
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func errBody(msg string) map[string]string {
	return map[string]string{"error": msg}
}

func methodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
}
