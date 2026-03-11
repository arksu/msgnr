-- name: CreateRefreshSession :one
INSERT INTO refresh_sessions (user_id, token_hash, user_agent, ip_addr, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetActiveRefreshSessionByTokenHash :one
SELECT * FROM refresh_sessions
WHERE token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > now();

-- name: RevokeRefreshSessionByID :exec
UPDATE refresh_sessions
SET revoked_at = now()
WHERE id = $1
  AND revoked_at IS NULL;

-- name: RevokeRefreshSessionByTokenHash :exec
UPDATE refresh_sessions
SET revoked_at = now()
WHERE token_hash = $1
  AND revoked_at IS NULL;
