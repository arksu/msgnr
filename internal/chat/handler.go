package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"msgnr/internal/auth"
	"msgnr/internal/config"
	"msgnr/internal/logger"
)

// Handler exposes chat-related HTTP endpoints.
// DMNotifier is the subset of ws.Server used by the chat handler to push
// direct-delivery events after a new DM is created.
type DMNotifier interface {
	SendChatDirectServerEvents(deliveries []DirectDelivery)
}

type Handler struct {
	svc      *Service
	authSvc  *auth.Service
	cfg      *config.Config
	log      *zap.Logger
	notifier DMNotifier // may be nil until SetNotifier is called
}

// NewHandler creates a Handler.
func NewHandler(svc *Service, authSvc *auth.Service, cfg *config.Config) *Handler {
	return &Handler{svc: svc, authSvc: authSvc, cfg: cfg, log: logger.Logger}
}

// SetNotifier wires the WS server for direct-delivery push after DM creation.
// Called after ws.Server is constructed (which depends on the chat service).
func (h *Handler) SetNotifier(n DMNotifier) {
	h.notifier = n
}

// RegisterRoutes registers chat HTTP routes on mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/channels", h.requireAuth(h.listChannels))
	mux.HandleFunc("/api/channels/available", h.requireAuth(h.listAvailableChannels))
	mux.HandleFunc("/api/channels/join", h.requireAuth(h.joinChannels))
	mux.HandleFunc("/api/conversations/leave", h.requireAuth(h.leaveConversation))
	mux.HandleFunc("/api/conversations/members", h.requireAuth(h.listConversationMembers))
	mux.HandleFunc("/api/conversations/invite", h.requireAuth(h.inviteToConversation))
	mux.HandleFunc("/api/messages", h.requireAuth(h.listConversationMessages))
	mux.HandleFunc("/api/messages/", h.requireAuth(h.messageAttachmentDownload))
	mux.HandleFunc("/api/chat/attachments", h.requireAuth(h.chatAttachments))
	mux.HandleFunc("/api/chat/attachments/", h.requireAuth(h.chatAttachmentItem))
	mux.HandleFunc("/api/dm-candidates", h.requireAuth(h.listDMCandidates))
	mux.HandleFunc("/api/dms", h.requireAuth(h.createOrOpenDirectMessage))
}

type channelResponse struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Kind           string `json:"kind"`
	Visibility     string `json:"visibility"`
	LastActivityAt string `json:"last_activity_at"`
}

type dmCandidateResponse struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	AvatarURL   string `json:"avatar_url"`
}

type createDirectMessageRequest struct {
	UserID string `json:"user_id"`
}

type joinChannelsRequest struct {
	ChannelIDs []string `json:"channel_ids"`
}

type leaveConversationRequest struct {
	ConversationID string `json:"conversation_id"`
}

type inviteConversationRequest struct {
	ConversationID string `json:"conversation_id"`
	UserID         string `json:"user_id"`
}

type conversationMemberResponse struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	AvatarURL   string `json:"avatar_url"`
}

type directMessageResponse struct {
	ConversationID string `json:"conversation_id"`
	UserID         string `json:"user_id"`
	DisplayName    string `json:"display_name"`
	Email          string `json:"email"`
	AvatarURL      string `json:"avatar_url"`
	Kind           string `json:"kind"`
	Visibility     string `json:"visibility"`
}

type conversationMessageResponse struct {
	ID                  string                      `json:"id"`
	ConversationID      string                      `json:"conversation_id"`
	SenderID            string                      `json:"sender_id"`
	SenderName          string                      `json:"sender_name"`
	Body                string                      `json:"body"`
	ChannelSeq          int64                       `json:"channel_seq"`
	ThreadSeq           int64                       `json:"thread_seq"`
	ThreadRootMessageID string                      `json:"thread_root_message_id"`
	ThreadReplyCount    int32                       `json:"thread_reply_count"`
	MentionEveryone     bool                        `json:"mention_everyone"`
	CreatedAt           string                      `json:"created_at"`
	Reactions           []reactionAggregateResponse `json:"reactions"`
	MyReactions         []string                    `json:"my_reactions"`
	Attachments         []messageAttachmentResponse `json:"attachments"`
}

type messageAttachmentResponse struct {
	ID       string `json:"id"`
	FileName string `json:"file_name"`
	FileSize int64  `json:"file_size"`
	MimeType string `json:"mime_type"`
}

type reactionAggregateResponse struct {
	Emoji string `json:"emoji"`
	Count int32  `json:"count"`
}

type conversationMessagesPageResponse struct {
	Messages             []conversationMessageResponse `json:"messages"`
	HasMore              bool                          `json:"has_more"`
	PageSize             int                           `json:"page_size"`
	NextBeforeChannelSeq string                        `json:"next_before_channel_seq,omitempty"`
}

func (h *Handler) listChannels(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	channels, err := h.svc.q.ListUserChannels(r.Context(), principal.UserID)
	if err != nil {
		h.log.Error("listChannels query error", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		return
	}

	resp := make([]channelResponse, 0, len(channels))
	for _, ch := range channels {
		name := ch.Name.String
		if !ch.Name.Valid || name == "" {
			name = ch.Kind
		}
		resp = append(resp, channelResponse{
			ID:             ch.ID.String(),
			Name:           name,
			Kind:           ch.Kind,
			Visibility:     ch.Visibility,
			LastActivityAt: ch.LastActivityAt.UTC().Format("2006-01-02T15:04:05Z"),
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) listAvailableChannels(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	channels, err := h.svc.ListAvailablePublicChannels(r.Context(), principal.UserID)
	if err != nil {
		h.log.Error("listAvailableChannels error", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		return
	}

	resp := make([]channelResponse, 0, len(channels))
	for _, ch := range channels {
		resp = append(resp, channelResponse{
			ID:             ch.ID.String(),
			Name:           ch.Name,
			Kind:           ch.Kind,
			Visibility:     ch.Visibility,
			LastActivityAt: ch.LastActivityAt.UTC().Format("2006-01-02T15:04:05Z"),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) joinChannels(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	var req joinChannelsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid json"))
		return
	}

	channelIDs := make([]uuid.UUID, 0, len(req.ChannelIDs))
	for _, rawID := range req.ChannelIDs {
		channelID, err := uuid.Parse(rawID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid channel_id"))
			return
		}
		channelIDs = append(channelIDs, channelID)
	}

	joined, err := h.svc.JoinPublicChannels(r.Context(), principal.UserID, channelIDs)
	if err != nil {
		h.log.Error("joinChannels error", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		return
	}
	if len(joined) > 0 && h.notifier != nil {
		deliveries := make([]DirectDelivery, 0, len(joined))
		for _, channel := range joined {
			deliveries = append(deliveries, buildChannelConversationUpsertedDelivery(principal.UserID, channel))
		}
		h.notifier.SendChatDirectServerEvents(deliveries)
	}

	resp := make([]channelResponse, 0, len(joined))
	for _, ch := range joined {
		resp = append(resp, channelResponse{
			ID:             ch.ID.String(),
			Name:           ch.Name,
			Kind:           ch.Kind,
			Visibility:     ch.Visibility,
			LastActivityAt: ch.LastActivityAt.UTC().Format("2006-01-02T15:04:05Z"),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) leaveConversation(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	var req leaveConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid json"))
		return
	}
	conversationID, err := uuid.Parse(req.ConversationID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid conversation_id"))
		return
	}

	result, err := h.svc.LeaveConversation(r.Context(), principal.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotMember):
			writeJSON(w, http.StatusForbidden, errorBody("not a member of this conversation"))
		default:
			h.log.Error("leaveConversation error", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		}
		return
	}
	if len(result.DirectDeliveries) > 0 && h.notifier != nil {
		h.notifier.SendChatDirectServerEvents(result.DirectDeliveries)
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) listConversationMembers(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	conversationID, err := uuid.Parse(r.URL.Query().Get("conversation_id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid conversation_id"))
		return
	}

	members, err := h.svc.ListConversationMembers(r.Context(), principal.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotMember):
			writeJSON(w, http.StatusForbidden, errorBody("not a member of this conversation"))
		default:
			h.log.Error("listConversationMembers error", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		}
		return
	}

	resp := make([]conversationMemberResponse, 0, len(members))
	for _, member := range members {
		resp = append(resp, conversationMemberResponse{
			UserID:      member.UserID.String(),
			DisplayName: member.DisplayName,
			Email:       member.Email,
			AvatarURL:   member.AvatarURL,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) listConversationMessages(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	conversationID, err := uuid.Parse(r.URL.Query().Get("conversation_id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid conversation_id"))
		return
	}

	var beforeChannelSeq *int64
	if raw := r.URL.Query().Get("before_channel_seq"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid before_channel_seq"))
			return
		}
		if parsed <= 0 {
			writeJSON(w, http.StatusBadRequest, errorBody("before_channel_seq must be > 0"))
			return
		}
		beforeChannelSeq = &parsed
	}

	pageSize := h.cfg.ChatHistoryPageSize
	if pageSize <= 0 {
		pageSize = 50
	}

	messages, hasMore, err := h.svc.ListMessagePage(
		r.Context(),
		principal.UserID,
		conversationID,
		beforeChannelSeq,
		pageSize,
	)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotMember):
			writeJSON(w, http.StatusForbidden, errorBody("not a member of this channel"))
		default:
			h.log.Error("listConversationMessages error", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		}
		return
	}

	resp := make([]conversationMessageResponse, 0, len(messages))
	for _, msg := range messages {
		threadRootID := ""
		if msg.ThreadRootMessageID != uuid.Nil {
			threadRootID = msg.ThreadRootMessageID.String()
		}
		reactions := make([]reactionAggregateResponse, 0, len(msg.Reactions))
		for _, reaction := range msg.Reactions {
			reactions = append(reactions, reactionAggregateResponse{
				Emoji: reaction.Emoji,
				Count: reaction.Count,
			})
		}
		attachments := make([]messageAttachmentResponse, 0, len(msg.Attachments))
		for _, attachment := range msg.Attachments {
			attachments = append(attachments, messageAttachmentResponse{
				ID:       attachment.ID.String(),
				FileName: attachment.FileName,
				FileSize: attachment.FileSize,
				MimeType: attachment.MimeType,
			})
		}
		resp = append(resp, conversationMessageResponse{
			ID:                  msg.ID.String(),
			ConversationID:      msg.ConversationID.String(),
			SenderID:            msg.SenderID.String(),
			SenderName:          msg.SenderName,
			Body:                msg.Body,
			ChannelSeq:          msg.ChannelSeq,
			ThreadSeq:           msg.ThreadSeq,
			ThreadRootMessageID: threadRootID,
			ThreadReplyCount:    msg.ThreadReplyCount,
			MentionEveryone:     msg.MentionEveryone,
			CreatedAt:           msg.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
			Reactions:           reactions,
			MyReactions:         msg.MyReactions,
			Attachments:         attachments,
		})
	}

	page := conversationMessagesPageResponse{
		Messages: resp,
		HasMore:  hasMore,
		PageSize: pageSize,
	}
	if hasMore && len(messages) > 0 {
		page.NextBeforeChannelSeq = strconv.FormatInt(messages[0].ChannelSeq, 10)
	}

	writeJSON(w, http.StatusOK, page)
}

// POST /api/chat/attachments
func (h *Handler) chatAttachments(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	maxAttachSizeMB := h.cfg.AttachmentMaxSizeMB
	if maxAttachSizeMB <= 0 {
		maxAttachSizeMB = 50
	}
	maxBytes := int64(maxAttachSizeMB) * 1024 * 1024
	formLimit := maxBytes + 2*1024*1024
	if err := r.ParseMultipartForm(formLimit); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("failed to parse multipart form: "+err.Error()))
		return
	}

	conversationID, err := uuid.Parse(strings.TrimSpace(r.FormValue("conversation_id")))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid conversation_id"))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("missing 'file' field in form"))
		return
	}
	defer file.Close()

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if header.Size < 0 {
		writeJSON(w, http.StatusBadRequest, errorBody("unable to determine file size"))
		return
	}
	if header.Size > maxBytes {
		writeJSON(w, http.StatusBadRequest, errorBody(fmt.Sprintf("invalid attachment: file exceeds maximum allowed size of %d MB", maxAttachSizeMB)))
		return
	}
	cr := &countingReader{r: io.LimitReader(file, header.Size)}

	attachment, err := h.svc.UploadMessageAttachment(r.Context(), UploadMessageAttachmentParams{
		ConversationID: conversationID,
		ActorID:        principal.UserID,
		FileName:       header.Filename,
		MimeType:       mimeType,
		Size:           header.Size,
		Body:           cr,
	}, cr)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotMember):
			writeJSON(w, http.StatusForbidden, errorBody("not a member of this conversation"))
		case errors.Is(err, ErrInvalidAttachment):
			writeJSON(w, http.StatusBadRequest, errorBody(err.Error()))
		default:
			h.log.Error("chatAttachments upload error", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		}
		return
	}

	writeJSON(w, http.StatusCreated, messageAttachmentResponse{
		ID:       attachment.ID.String(),
		FileName: attachment.FileName,
		FileSize: attachment.FileSize,
		MimeType: attachment.MimeType,
	})
}

// DELETE /api/chat/attachments/:attachment_id
func (h *Handler) chatAttachmentItem(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodDelete {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	rawID := strings.TrimPrefix(r.URL.Path, "/api/chat/attachments/")
	attachmentID, err := uuid.Parse(rawID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid attachment_id"))
		return
	}

	if err := h.svc.DeleteStagedMessageAttachment(r.Context(), principal.UserID, attachmentID); err != nil {
		switch {
		case errors.Is(err, ErrAttachmentNotFound):
			writeJSON(w, http.StatusNotFound, errorBody("attachment not found"))
		case errors.Is(err, ErrAttachmentOwnership):
			writeJSON(w, http.StatusForbidden, errorBody("attachment does not belong to user"))
		case errors.Is(err, ErrAttachmentNotStaged):
			writeJSON(w, http.StatusConflict, errorBody("attachment already linked to a message"))
		default:
			h.log.Error("chatAttachmentItem delete error", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/messages/:message_id/attachments/:attachment_id/download
func (h *Handler) messageAttachmentDownload(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	rest := strings.TrimPrefix(r.URL.Path, "/api/messages/")
	parts := strings.Split(rest, "/")
	if len(parts) != 4 || parts[1] != "attachments" || parts[3] != "download" {
		writeJSON(w, http.StatusNotFound, errorBody("not found"))
		return
	}
	messageID, err := uuid.Parse(parts[0])
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid message_id"))
		return
	}
	attachmentID, err := uuid.Parse(parts[2])
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid attachment_id"))
		return
	}

	body, size, mimeType, fileName, err := h.svc.DownloadMessageAttachment(r.Context(), principal.UserID, messageID, attachmentID)
	if err != nil {
		switch {
		case errors.Is(err, ErrAttachmentNotFound):
			writeJSON(w, http.StatusNotFound, errorBody("attachment not found"))
		case errors.Is(err, ErrNotMember):
			writeJSON(w, http.StatusForbidden, errorBody("not a member of this conversation"))
		default:
			h.log.Error("messageAttachmentDownload error", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		}
		return
	}
	defer body.Close()

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Disposition", `attachment; filename="`+sanitiseHeaderValue(fileName)+`"`)
	w.WriteHeader(http.StatusOK)
	io.Copy(w, body) //nolint:errcheck
}

func (h *Handler) listDMCandidates(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	candidates, err := h.svc.ListDMCandidates(r.Context(), principal.UserID)
	if err != nil {
		h.log.Error("listDMCandidates query error", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		return
	}

	resp := make([]dmCandidateResponse, 0, len(candidates))
	for _, candidate := range candidates {
		resp = append(resp, dmCandidateResponse{
			UserID:      candidate.UserID.String(),
			DisplayName: candidate.DisplayName,
			Email:       candidate.Email,
			AvatarURL:   candidate.AvatarURL,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) createOrOpenDirectMessage(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	var req createDirectMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid json"))
		return
	}

	targetUserID, err := uuid.Parse(req.UserID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid user_id"))
		return
	}

	result, err := h.svc.CreateOrOpenDirectMessage(r.Context(), principal.UserID, targetUserID)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidDMTarget):
			writeJSON(w, http.StatusBadRequest, errorBody("invalid dm target"))
		case errors.Is(err, ErrBlockedDMTarget):
			writeJSON(w, http.StatusNotFound, errorBody("user not available"))
		default:
			h.log.Error("createOrOpenDirectMessage error", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		}
		return
	}

	// Push conversation_upserted to affected participants when a DM was
	// created or restored.
	if len(result.DirectDeliveries) > 0 && h.notifier != nil {
		h.notifier.SendChatDirectServerEvents(result.DirectDeliveries)
	}

	dm := result.DM
	writeJSON(w, http.StatusOK, directMessageResponse{
		ConversationID: dm.ConversationID.String(),
		UserID:         dm.UserID.String(),
		DisplayName:    dm.DisplayName,
		Email:          dm.Email,
		AvatarURL:      dm.AvatarURL,
		Kind:           dm.Kind,
		Visibility:     dm.Visibility,
	})
}

func (h *Handler) inviteToConversation(w http.ResponseWriter, r *http.Request, principal auth.Principal) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorBody("method not allowed"))
		return
	}

	var req inviteConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid json"))
		return
	}

	conversationID, err := uuid.Parse(req.ConversationID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid conversation_id"))
		return
	}
	targetUserID, err := uuid.Parse(req.UserID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid user_id"))
		return
	}

	result, err := h.svc.InviteToChannel(r.Context(), principal.UserID, conversationID, targetUserID)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotMember):
			writeJSON(w, http.StatusForbidden, errorBody("not a member of this conversation"))
		case errors.Is(err, ErrInviteUnsupportedTarget):
			writeJSON(w, http.StatusForbidden, errorBody("cannot invite users to this conversation"))
		case errors.Is(err, ErrConversationArchived):
			writeJSON(w, http.StatusForbidden, errorBody("cannot invite users to archived conversations"))
		case errors.Is(err, ErrNotPublicChannel):
			writeJSON(w, http.StatusForbidden, errorBody("conversation not found"))
		default:
			h.log.Error("inviteToConversation error", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, errorBody("internal error"))
		}
		return
	}

	// Push conversation_upserted to the invited user so their sidebar
	// updates in real time without waiting for a re-bootstrap.
	if len(result.DirectDeliveries) > 0 && h.notifier != nil {
		h.notifier.SendChatDirectServerEvents(result.DirectDeliveries)
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// requireAuth is a thin middleware that validates the Bearer JWT and injects
// the Principal into the handler.
func (h *Handler) requireAuth(next func(w http.ResponseWriter, r *http.Request, p auth.Principal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, errorBody("missing authorization"))
			return
		}
		principal, err := h.authSvc.VerifyAccess(r.Context(), token)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, errorBody("invalid or expired token"))
			return
		}
		next(w, r, principal)
	}
}

func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) > len(prefix) && h[:len(prefix)] == prefix {
		return h[len(prefix):]
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body) //nolint:errcheck
}

func errorBody(msg string) map[string]string {
	return map[string]string{"error": msg}
}

// countingReader tracks bytes consumed while streaming multipart file contents.
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

func (c *countingReader) BytesRead() int64 { return c.n }

// sanitiseHeaderValue removes characters that are illegal in HTTP header values.
func sanitiseHeaderValue(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r == '"' || r == '\\' || r <= 0x1f || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
