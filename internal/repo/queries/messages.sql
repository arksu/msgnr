-- name: InsertMessage :one
WITH seq AS (
    UPDATE channels
    SET next_seq = next_seq + 1,
        last_activity_at = now()
    WHERE id = @channel_id
    RETURNING next_seq
)
INSERT INTO messages (channel_id, channel_seq, sender_id, client_msg_id, body,
                      thread_root_id, thread_seq, mention_everyone, created_at)
VALUES (@channel_id,
        (SELECT next_seq FROM seq),
        @sender_id,
        @client_msg_id,
        @body,
        @thread_root_id,
        @thread_seq,
        @mention_everyone,
        now())
RETURNING id, channel_id, channel_seq, sender_id, client_msg_id, body,
          thread_root_id, thread_seq, mention_everyone, created_at;

-- name: GetMessageByClientMsgID :one
SELECT id, channel_id, channel_seq, sender_id, client_msg_id, body,
       thread_root_id, thread_seq, mention_everyone, created_at
FROM messages
WHERE channel_id = @channel_id
  AND client_msg_id = @client_msg_id
LIMIT 1;

-- name: GetMessageByID :one
SELECT id, channel_id, channel_seq, sender_id, client_msg_id, body,
       thread_root_id, thread_seq, mention_everyone, created_at
FROM messages
WHERE id = @message_id;

-- name: InsertMessageMention :exec
INSERT INTO message_mentions (message_id, user_id, created_at)
VALUES (@message_id, @user_id, now())
ON CONFLICT DO NOTHING;

-- name: GetThreadSummary :one
SELECT root_message_id, reply_count, next_thread_seq, last_reply_at, last_reply_user_id
FROM thread_summaries
WHERE root_message_id = @root_message_id;

-- name: GetThreadMessages :many
SELECT m.id, m.channel_id, m.channel_seq, m.sender_id, m.client_msg_id, m.body,
       m.thread_root_id, m.thread_seq, m.mention_everyone, m.created_at
FROM messages m
WHERE m.thread_root_id = @root_message_id
  AND m.thread_seq > @after_thread_seq
ORDER BY m.thread_seq ASC;

-- name: InsertReaction :one
INSERT INTO reactions (message_id, user_id, emoji, created_at)
VALUES (@message_id, @user_id, @emoji, now())
ON CONFLICT DO NOTHING
RETURNING message_id, user_id, emoji, created_at;

-- name: DeleteReaction :one
DELETE FROM reactions
WHERE message_id = @message_id
  AND user_id    = @user_id
  AND emoji      = @emoji
RETURNING message_id, user_id, emoji, created_at;

-- name: IncrementReactionCount :one
INSERT INTO reaction_counts (message_id, emoji, count)
VALUES (@message_id, @emoji, 1)
ON CONFLICT (message_id, emoji) DO UPDATE
    SET count = reaction_counts.count + 1
RETURNING message_id, emoji, count;

-- name: DecrementReactionCount :one
UPDATE reaction_counts
SET count = count - 1
WHERE message_id = @message_id
  AND emoji      = @emoji
RETURNING message_id, emoji, count;

-- name: DeleteReactionCountIfZero :exec
DELETE FROM reaction_counts
WHERE message_id = @message_id
  AND emoji      = @emoji
  AND count      <= 0;

-- name: GetReactionCounts :many
SELECT message_id, emoji, count
FROM reaction_counts
WHERE message_id = @message_id
ORDER BY emoji ASC;

-- name: IsChannelMember :one
SELECT EXISTS (
    SELECT 1 FROM channel_members
    WHERE channel_id = @channel_id
      AND user_id    = @user_id
      AND is_archived = false
) AS is_member;

-- name: ListReactionUsersByMessageEmoji :many
SELECT r.user_id,
       COALESCE(NULLIF(u.display_name, ''), u.email) AS display_name,
       u.avatar_url
FROM reactions r
JOIN users u ON u.id = r.user_id
WHERE r.message_id = @message_id
  AND r.emoji = @emoji
ORDER BY r.created_at DESC, r.user_id;

-- name: ListConversationMessagePage :many
SELECT m.id, m.channel_id, m.sender_id, u.display_name, m.body, m.channel_seq,
       COALESCE(m.thread_seq, 0) AS thread_seq,
       m.thread_root_id,
       COALESCE(ts.reply_count, 0) AS thread_reply_count,
       m.created_at,
       m.mention_everyone,
       COALESCE((
         SELECT json_agg(json_build_object('emoji', rc.emoji, 'count', rc.count) ORDER BY rc.emoji)
           FROM reaction_counts rc
          WHERE rc.message_id = m.id
       ), '[]'::json) AS reactions,
       COALESCE((
         SELECT json_agg(r.emoji ORDER BY r.emoji)
           FROM reactions r
          WHERE r.message_id = m.id
            AND r.user_id = @requester_id
       ), '[]'::json) AS my_reactions,
       COALESCE((
         SELECT json_agg(json_build_object(
           'id', ma.id,
           'conversation_id', ma.conversation_id,
           'message_id', ma.message_id,
           'file_name', ma.file_name,
           'file_size', ma.file_size,
           'mime_type', ma.mime_type,
           'uploaded_by', ma.uploaded_by,
           'created_at', ma.created_at
         ) ORDER BY ma.created_at, ma.id)
           FROM message_attachment ma
          WHERE ma.message_id = m.id
       ), '[]'::json) AS attachments
FROM messages m
JOIN users u ON u.id = m.sender_id
LEFT JOIN thread_summaries ts ON ts.root_message_id = m.id
WHERE m.channel_id = @conversation_id
  AND m.thread_root_id IS NULL
  AND m.channel_seq < @before_channel_seq
ORDER BY m.channel_seq DESC
LIMIT @query_limit;

-- name: ListUserChannels :many
SELECT c.id, c.kind, c.visibility, c.name, c.topic, c.is_archived,
       c.next_seq, c.last_activity_at, c.created_at
FROM channels c
JOIN channel_members cm ON cm.channel_id = c.id
WHERE cm.user_id = @user_id
  AND cm.is_archived = false
  AND c.is_archived = false
ORDER BY c.last_activity_at DESC;
