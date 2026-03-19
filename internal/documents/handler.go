package documents

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"msgnr/internal/auth"
)

type Handler struct {
	svc     *Service
	authSvc *auth.Service
	log     *zap.Logger
}

type authHandler func(w http.ResponseWriter, r *http.Request, p auth.Principal)

func NewHandler(svc *Service, authSvc *auth.Service, log *zap.Logger) *Handler {
	if log == nil {
		log = zap.NewNop()
	}
	return &Handler{
		svc:     svc,
		authSvc: authSvc,
		log:     log,
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/documents/teamspaces", h.requireAuth(h.teamspacesCollection))
	mux.HandleFunc("/api/documents/teamspaces/", h.requireAuth(h.teamspacesItem))
	mux.HandleFunc("/api/documents/sidebar", h.requireAuth(h.sidebarCollection))
	mux.HandleFunc("/api/documents", h.requireAuth(h.documentsCollection))
	mux.HandleFunc("/api/documents/", h.requireAuth(h.documentItem))
}

func (h *Handler) teamspacesCollection(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	switch r.Method {
	case http.MethodGet:
		rows, err := h.svc.ListTeamspaces(r.Context(), p.UserID, p.Role)
		if err != nil {
			h.serviceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	case http.MethodPost:
		var req struct {
			Name      string      `json:"name"`
			IsPrivate bool        `json:"is_private"`
			MemberIDs []uuid.UUID `json:"member_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		row, err := h.svc.CreateTeamspace(r.Context(), CreateTeamspaceParams{
			Name:      req.Name,
			IsPrivate: req.IsPrivate,
			MemberIDs: req.MemberIDs,
			ActorID:   p.UserID,
		}, p.Role)
		if err != nil {
			h.serviceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, row)
	default:
		methodNotAllowed(w)
	}
}

func (h *Handler) teamspacesItem(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/documents/teamspaces/")
	if rest == "" {
		writeJSON(w, http.StatusNotFound, errBody("not found"))
		return
	}
	if rawID, ok := strings.CutSuffix(rest, "/join"); ok {
		id, err := uuid.Parse(rawID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid teamspace id"))
			return
		}
		h.teamspaceJoin(w, r, p, id)
		return
	}

	id, err := uuid.Parse(rest)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid teamspace id"))
		return
	}
	h.teamspaceItem(w, r, p, id)
}

func (h *Handler) teamspaceItem(w http.ResponseWriter, r *http.Request, p auth.Principal, id uuid.UUID) {
	if r.Method != http.MethodPatch {
		methodNotAllowed(w)
		return
	}

	var req struct {
		Name      string      `json:"name"`
		IsPrivate bool        `json:"is_private"`
		MemberIDs []uuid.UUID `json:"member_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
		return
	}

	row, err := h.svc.UpdateTeamspace(r.Context(), id, UpdateTeamspaceParams{
		Name:      req.Name,
		IsPrivate: req.IsPrivate,
		MemberIDs: req.MemberIDs,
		ActorID:   p.UserID,
		ActorRole: p.Role,
	})
	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (h *Handler) teamspaceJoin(w http.ResponseWriter, r *http.Request, p auth.Principal, id uuid.UUID) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	row, err := h.svc.JoinTeamspace(r.Context(), id, p.UserID, p.Role)
	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (h *Handler) sidebarCollection(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	rows, err := h.svc.ListSidebar(r.Context(), p.UserID)
	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (h *Handler) documentsCollection(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var req struct {
		TeamspaceID      uuid.UUID  `json:"teamspace_id"`
		ParentDocumentID *uuid.UUID `json:"parent_document_id"`
		Title            string     `json:"title"`
		ContentMarkdown  *string    `json:"content_markdown"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
		return
	}

	row, err := h.svc.CreateDocument(r.Context(), CreateDocumentParams{
		TeamspaceID:      req.TeamspaceID,
		ParentDocumentID: req.ParentDocumentID,
		Title:            req.Title,
		ContentMarkdown:  req.ContentMarkdown,
		ActorID:          p.UserID,
	})
	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (h *Handler) documentItem(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/documents/")
	if rest == "" {
		writeJSON(w, http.StatusNotFound, errBody("not found"))
		return
	}
	if rawID, ok := strings.CutSuffix(rest, "/history"); ok {
		id, err := uuid.Parse(rawID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid document id"))
			return
		}
		h.documentHistoryItem(w, r, p, id)
		return
	}

	id, err := uuid.Parse(rest)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid document id"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		row, err := h.svc.GetDocument(r.Context(), id, p.UserID)
		if err != nil {
			h.serviceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, row)
	case http.MethodPatch:
		var req struct {
			Title           *string `json:"title"`
			ContentMarkdown *string `json:"content_markdown"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		row, err := h.svc.UpdateDocument(r.Context(), id, UpdateDocumentParams{
			Title:           req.Title,
			ContentMarkdown: req.ContentMarkdown,
			ActorID:         p.UserID,
		})
		if err != nil {
			h.serviceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, row)
	default:
		methodNotAllowed(w)
	}
}

func (h *Handler) documentHistoryItem(w http.ResponseWriter, r *http.Request, p auth.Principal, id uuid.UUID) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	rows, err := h.svc.ListDocumentHistory(r.Context(), id, p.UserID)
	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

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

func (h *Handler) serviceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, errBody(err.Error()))
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, errBody(err.Error()))
	case errors.Is(err, ErrConflict):
		writeJSON(w, http.StatusConflict, errBody(err.Error()))
	case errors.Is(err, ErrBadRequest):
		writeJSON(w, http.StatusBadRequest, errBody(err.Error()))
	default:
		h.log.Error("documents: internal error", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func errBody(msg string) map[string]string {
	return map[string]string{"error": msg}
}

func bearerToken(r *http.Request) string {
	value := r.Header.Get("Authorization")
	if after, ok := strings.CutPrefix(value, "Bearer "); ok {
		return strings.TrimSpace(after)
	}
	return ""
}

func methodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
}
