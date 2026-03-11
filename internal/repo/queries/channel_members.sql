-- name: GetChannelMember :one
SELECT channel_id, user_id, is_muted, created_at
FROM channel_members
WHERE channel_id = $1
  AND user_id = $2
  AND is_archived = false
LIMIT 1;
