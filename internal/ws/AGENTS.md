# WS Package Notes for Agents

This package owns the protobuf-over-WebSocket lifecycle.

## Responsibilities

1. Enforce the connection state machine: hello, auth, authenticated dispatch.
2. Serialize all outbound frames through a single writer goroutine.
3. Subscribe authenticated sessions to the event bus with authorization filtering.
4. Map authenticated payloads to backend services and protocol errors.

## Invariants

1. No domain payload may run before successful auth.
2. Outbound backpressure overflow must produce the protocol error and close the session.
3. All server-pushed realtime events are wrapped as `Envelope.server_event`.
4. `ServerHello.rate_limit_policy` must reflect current runtime limits from config.
5. Auth responses and domain responses must preserve request/trace correlation from the incoming envelope.

## Change Guidance

1. Keep the reader/writer split intact; do not introduce multiple concurrent socket writers.
2. Prefer small dispatch additions in `handleDomainPayload` over hidden side channels.
3. Error mapping matters: invalid ids/tokens are `BAD_REQUEST`, auth failures remain auth failures, bootstrap expiry uses `BOOTSTRAP_EXPIRED`.
4. If the WS lifecycle changes, update `web/src/stores/ws.ts` and relevant tests in the same change.
5. When backend service methods return direct-delivery server events (for example immediate read-counter updates after `SubscribeThread`), forward them to all active sessions for that user in the same request flow.

## Tests

1. Use `server_fanout_test.go` for bus/fanout behavior.
2. Add integration-style coverage when handshake/auth/dispatch sequencing changes.
