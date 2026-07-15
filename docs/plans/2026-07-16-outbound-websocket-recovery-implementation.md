# Outbound WebSocket Recovery Implementation Plan

Date: 2026-07-16
Design: `docs/plans/2026-07-16-outbound-websocket-recovery-design.md`

## Goal

Detect a client-to-server WebSocket failure that can coexist with incoming
realtime events, reconnect automatically, and durably replay all outstanding
plaintext messages without duplicate server rows or duplicate UI bubbles.

## Constraints

- Preserve the unrelated untracked workspace files.
- Keep the existing reconnect/bootstrap owner in `useSessionOrchestrator`.
- Do not use the plaintext offline queue for encrypted-DM content.
- Keep protocol changes additive and capability-gated for rolling deployment.
- Preserve `client_msg_id` for every replayed send.

## Phase 1: Add the capability and correlated heartbeat protocol

### Files

- Modify `api/proto/packets.proto`.
- Regenerate `internal/gen/proto/packets.pb.go` and
  `web/src/shared/proto/packets_pb.ts` with `cd web && npm run proto:gen`.

### Steps

1. Append `FEATURE_CAPABILITY_TRANSPORT_HEARTBEAT` with the next enum value.
2. Append `TransportHeartbeatRequest` and `TransportHeartbeatAck` oneof fields
   using unused field numbers; do not renumber existing fields.
3. Add empty request and acknowledgement message definitions near the existing
   presence heartbeat types.
4. Generate both bindings through the web script, then run Buf lint.

### Completion check

- Both Go and TypeScript bindings expose the capability and request/ack types.
- Existing protocol version remains unchanged because the change is additive.

## Phase 2: Answer the probe on the backend

### Files

- Modify `internal/ws/server.go`.
- Add `internal/ws/server_transport_heartbeat_test.go`.

### Steps

1. Add the capability to `supportedCapabilities`; existing negotiation will
   advertise it only when the client offers it.
2. Add an authenticated `handleDomainPayload` case that validates the request
   and queues a `TransportHeartbeatAck` through the existing writer queue.
3. Copy the incoming request and trace IDs to the acknowledgement envelope.
4. Unit-test capability negotiation and direct handler dispatch without the
   DB-backed WebSocket integration suite.

### Completion check

- A negotiated client receives exactly one correlated heartbeat ACK.
- The handler adds no database or presence side effect.

## Phase 3: Detect a stale browser transport

### Files

- Modify `web/src/stores/ws.ts`.
- Modify `web/src/stores/__tests__/wsStore.test.ts`.

### Steps

1. Add capability support detection next to the existing presence-heartbeat
   predicates.
2. After auth, immediately send a correlated transport heartbeat and repeat it
   every 30 seconds only when the capability was negotiated.
3. Reuse `requestEnvelope` so request IDs and the 15-second response deadline
   are already correlated by the pending-request map.
4. On a heartbeat timeout for the still-current socket generation, call
   `invalidateTransport('Transport heartbeat timed out')`.
5. Do not treat an unrelated inbound event as a heartbeat response.
6. Cancel the interval and invalidate stale promise continuations on connect,
   close/error, explicit invalidation, disconnect, and store reset.
7. Test success, missing/wrong ACK, no negotiated capability, and cleanup.

### Completion check

- A stale locally-open socket enters the existing reconnect path at most once.
- A timeout from an old connection cannot invalidate a later successful one.

## Phase 4: Queue outstanding plaintext sends before reconnect

### Files

- Modify `web/src/stores/chat.ts`.
- Modify `web/src/composables/useSessionOrchestrator.ts`.
- Modify `web/src/stores/__tests__/chatStore.test.ts`.
- Modify `web/src/composables/__tests__/useSessionOrchestrator.test.ts`.

### Steps

1. Add a chat-store action that finds all currently `sending` plaintext root
   and thread messages, changes them to `queued`, clears their send timers, and
   puts their exact payloads into `useOfflineQueue`.
2. Include original client message ID, attachment IDs, entities, and thread
   root in every queue record. Queue deduplication remains keyed by client ID.
3. Exclude non-plaintext/encrypted messages. They can cause reconnect but stay
   failed until an E2EE-safe retry path exists.
4. Call the chat-store action synchronously from the orchestrator's transport
   drop callback before it schedules reconnect, covering native close and
   heartbeat invalidation.
5. Change a message-ACK timeout to trigger transport invalidation rather than
   leaving a plaintext retry on the same `LIVE_SYNCED` socket. Queue before the
   invalidation call to avoid a reconnect race.
6. Add the same duplicate-ID guard already used by thread reconciliation to
   normal conversation reconciliation, so an early server event plus later
   deduplicated ACK leaves one bubble.
7. Test one and multiple pending messages, thread messages, attachments,
   repeated drop idempotency, timely ACK cleanup, and encrypted exclusion.

### Completion check

- A lost ACK changes ordinary messages to queued and starts reconnect.
- No manual Retry click is needed after the backend returns.

## Phase 5: Flush only after state recovery is live

### Files

- Modify `web/src/views/MainView.vue`.
- Modify `web/src/views/__tests__/MainView.test.ts`.
- Add `web/src/composables/__tests__/useOfflineQueue.test.ts`.

### Steps

1. Leave auth-time startup and bootstrap initiation at `AUTH_COMPLETE`, but
   defer outbound queue flush until `LIVE_SYNCED`.
2. This prevents bootstrap from clearing a newly replayed message's timer or
   optimistic overlay after the queue removes it locally.
3. Retain the status callback that moves queued messages to sending and starts
   their ACK timer only after the resend has been locally accepted.
4. Test queue flush metadata preservation, mid-flush retention, and duplicate
   enqueue protection.
5. Add a view assertion that reconnecting renders the existing banner, queue
   count, and Retry now action.

### Completion check

- Resends happen after authoritative bootstrap/sync and remain observable until
  ACK or server event reconciliation.

## Verification

Run the following targeted checks, then the full frontend build:

```bash
cd web && npm run proto:gen
cd ../api/proto && ../../web/node_modules/.bin/buf lint
cd ../.. && go test ./internal/ws -run 'Test(TransportHeartbeat|NegotiateCapabilities)' -count=1
cd web && npm test -- src/stores/__tests__/wsStore.test.ts src/composables/__tests__/useSessionOrchestrator.test.ts src/stores/__tests__/chatStore.test.ts src/views/__tests__/MainView.test.ts src/composables/__tests__/useOfflineQueue.test.ts
npm run build
cd .. && git diff --check
```

Run broader frontend tests only after targeted regressions are green; record
pre-existing failures separately from this change.
