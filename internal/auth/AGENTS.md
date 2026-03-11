# Auth Package Notes for Agents

This package owns HTTP auth and WS principal verification.

## Responsibilities

1. Login, refresh rotation, and logout over HTTP.
2. Refresh-session persistence and revocation.
3. Access-token verification for WS and authenticated handlers.
4. Channel-scoped authorization checks for server-pushed events.

## Invariants

1. Refresh uses rotation: revoke old session, create new session, issue new access token.
2. Blocked users must fail both login/refresh and WS access verification.
3. WS `Principal` is derived from a verified access token plus an active refresh session row.
4. Auth metrics/logging should distinguish invalid credentials, blocked users, and internal errors.

## Change Guidance

1. Keep HTTP handler behavior thin; business rules belong in `service.go`.
2. Reuse repository interfaces for tests instead of reaching directly into DB where unit tests suffice.
3. If auth payloads change, update both HTTP handlers and WS auth response wiring.
4. Do not weaken session checks to trust JWT claims alone.

## Tests

1. Unit-test token and service logic first.
2. Use integration coverage only when DB-backed session behavior is the point of the change.
