-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: ListActiveUsers :many
SELECT id, display_name, email, avatar_url
FROM users
WHERE status = 'active'
ORDER BY display_name ASC;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = $2, need_change_password = FALSE, updated_at = now()
WHERE id = $1;
