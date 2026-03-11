package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"msgnr/internal/auth"
)

// Notifier is the subset of ws.Server used by the admin handler to push
// real-time events to connected clients without importing the ws package.
type Notifier interface {
	SendForcePasswordChange(userID string)
}

// Handler exposes admin REST endpoints under /api/admin/.
// Every request must carry a valid JWT; role must be admin or owner.
type Handler struct {
	svc      *Service
	authSvc  *auth.Service
	notifier Notifier
	log      *zap.Logger
}

func NewHandler(svc *Service, authSvc *auth.Service, notifier Notifier, log *zap.Logger) *Handler {
	return &Handler{svc: svc, authSvc: authSvc, notifier: notifier, log: log}
}

// RegisterRoutes mounts all admin routes on mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/admin/users", h.adminOnly(h.users))
	mux.HandleFunc("/api/admin/users/", h.adminOnly(h.usersItem))
	mux.HandleFunc("/api/admin/channels", h.adminOnly(h.channels))
	mux.HandleFunc("/api/admin/channels/", h.adminOnly(h.channelsItem))
}

// ---- /api/admin/users ----

func (h *Handler) users(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := h.svc.ListUsers(r.Context())
		if err != nil {
			h.internalError(w, "list users", err)
			return
		}
		writeJSON(w, http.StatusOK, rows)

	case http.MethodPost:
		var req struct {
			Email              string `json:"email"`
			Password           string `json:"password"`
			DisplayName        string `json:"display_name"`
			Role               string `json:"role"`
			NeedChangePassword *bool  `json:"need_change_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		// Default need_change_password to true when not explicitly set.
		needChangePassword := true
		if req.NeedChangePassword != nil {
			needChangePassword = *req.NeedChangePassword
		}
		row, err := h.svc.CreateUser(r.Context(), CreateUserParams{
			Email:              req.Email,
			Password:           req.Password,
			DisplayName:        req.DisplayName,
			Role:               req.Role,
			NeedChangePassword: needChangePassword,
		})
		if err != nil {
			h.serviceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, row)

	default:
		writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
	}
}

// ---- /api/admin/users/{id}  and  /api/admin/users/{id}/{action} ----

func (h *Handler) usersItem(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	parts := strings.SplitN(path, "/", 2)

	id, err := uuid.Parse(parts[0])
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid user id"))
		return
	}

	// PATCH /api/admin/users/{id} — update display_name, email, role, password
	if len(parts) == 1 {
		if r.Method != http.MethodPatch {
			writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
			return
		}
		var req struct {
			DisplayName string `json:"display_name"`
			Email       string `json:"email"`
			Role        string `json:"role"`
			Password    string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		row, err := h.svc.UpdateUser(r.Context(), id, UpdateUserParams{
			DisplayName: req.DisplayName,
			Email:       req.Email,
			Role:        req.Role,
			Password:    req.Password,
		})
		if err != nil {
			h.serviceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, row)
		return
	}

	// POST /api/admin/users/{id}/{action}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
		return
	}

	var row UserRow
	switch parts[1] {
	case "block":
		row, err = h.svc.BlockUser(r.Context(), id)
	case "unblock":
		row, err = h.svc.UnblockUser(r.Context(), id)
	case "set-need-change-password":
		var req struct {
			NeedChangePassword bool `json:"need_change_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		row, err = h.svc.SetNeedChangePassword(r.Context(), id, req.NeedChangePassword)
		if err != nil {
			h.serviceError(w, err)
			return
		}
		if req.NeedChangePassword {
			h.notifier.SendForcePasswordChange(id.String())
		}
		writeJSON(w, http.StatusOK, row)
		return
	default:
		writeJSON(w, http.StatusNotFound, errBody("not found"))
		return
	}

	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// ---- /api/admin/channels ----

func (h *Handler) channels(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := h.svc.ListChannels(r.Context())
		if err != nil {
			h.internalError(w, "list channels", err)
			return
		}
		writeJSON(w, http.StatusOK, rows)

	case http.MethodPost:
		principal := principalFromCtx(r)
		var req struct {
			Name        string   `json:"name"`
			Visibility  string   `json:"visibility"`
			AddAllUsers bool     `json:"add_all_users"`
			MemberIDs   []string `json:"member_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		memberIDs := make([]uuid.UUID, 0, len(req.MemberIDs))
		for _, raw := range req.MemberIDs {
			memberID, err := uuid.Parse(raw)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, errBody("invalid member_ids"))
				return
			}
			memberIDs = append(memberIDs, memberID)
		}
		row, err := h.svc.CreateChannel(r.Context(), CreateChannelParams{
			Name:        req.Name,
			Visibility:  req.Visibility,
			CreatedBy:   principal.UserID,
			AddAllUsers: req.AddAllUsers,
			MemberIDs:   memberIDs,
		})
		if err != nil {
			h.serviceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, row)

	default:
		writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
	}
}

// ---- /api/admin/channels/{id}  and  /api/admin/channels/{id}/members[/{userID}] ----

func (h *Handler) channelsItem(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/channels/")
	// path is one of:
	//   {id}                       DELETE → delete channel
	//   {id}/members               GET → list members, POST → add member
	//   {id}/members/{userID}      DELETE → remove member

	parts := strings.SplitN(path, "/", 3)

	channelID, err := uuid.Parse(parts[0])
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid channel id"))
		return
	}

	// /api/admin/channels/{id}
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodDelete:
			if err := h.svc.DeleteChannel(r.Context(), channelID); err != nil {
				h.serviceError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case http.MethodPatch, http.MethodPut:
			var req struct {
				Name string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
				return
			}
			row, err := h.svc.RenameChannel(r.Context(), channelID, req.Name)
			if err != nil {
				h.serviceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, row)
			return
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
			return
		}
	}

	if parts[1] != "members" {
		writeJSON(w, http.StatusNotFound, errBody("not found"))
		return
	}

	// /api/admin/channels/{id}/members
	if len(parts) == 2 {
		switch r.Method {
		case http.MethodGet:
			rows, err := h.svc.ListChannelMembers(r.Context(), channelID)
			if err != nil {
				h.internalError(w, "list members", err)
				return
			}
			writeJSON(w, http.StatusOK, rows)

		case http.MethodPost:
			var req struct {
				UserID string `json:"user_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
				return
			}
			userID, err := uuid.Parse(req.UserID)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, errBody("invalid user_id"))
				return
			}
			if err := h.svc.AddChannelMember(r.Context(), channelID, userID); err != nil {
				h.serviceError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
		}
		return
	}

	// /api/admin/channels/{id}/members/{userID}
	userID, err := uuid.Parse(parts[2])
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("invalid user id"))
		return
	}
	if r.Method != http.MethodDelete {
		writeJSON(w, http.StatusMethodNotAllowed, errBody("method not allowed"))
		return
	}
	if err := h.svc.RemoveChannelMember(r.Context(), channelID, userID); err != nil {
		h.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- middleware ----

type ctxKey struct{}

func (h *Handler) adminOnly(next http.HandlerFunc) http.HandlerFunc {
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

		if principal.Role != "admin" && principal.Role != "owner" {
			writeJSON(w, http.StatusForbidden, errBody("admin role required"))
			return
		}

		ctx := r.Context()
		ctx = contextWithPrincipal(ctx, principal)
		next(w, r.WithContext(ctx))
	}
}

// ---- context helpers ----

func contextWithPrincipal(ctx context.Context, p auth.Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

func principalFromCtx(r *http.Request) auth.Principal {
	if p, ok := r.Context().Value(ctxKey{}).(auth.Principal); ok {
		return p
	}
	return auth.Principal{}
}

// ---- error helpers ----

func (h *Handler) serviceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, errBody(err.Error()))
	case errors.Is(err, ErrConflict):
		writeJSON(w, http.StatusConflict, errBody(err.Error()))
	case errors.Is(err, ErrBadRequest):
		writeJSON(w, http.StatusBadRequest, errBody(err.Error()))
	default:
		h.internalError(w, "", err)
	}
}

func (h *Handler) internalError(w http.ResponseWriter, msg string, err error) {
	if msg != "" {
		h.log.Error("admin: "+msg, zap.Error(err))
	} else {
		h.log.Error("admin: internal error", zap.Error(err))
	}
	writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func errBody(msg string) map[string]string {
	return map[string]string{"error": msg}
}

func bearerToken(r *http.Request) string {
	v := r.Header.Get("Authorization")
	if after, ok := strings.CutPrefix(v, "Bearer "); ok {
		return strings.TrimSpace(after)
	}
	return ""
}
