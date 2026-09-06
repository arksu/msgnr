# Raise Hand in Calls

## Goal

Let active call participants raise and lower a hand, with one shared and
deterministic numbered queue visible on every participant tile.

## Design

The server owns the queue. `call_participants` receives a nullable
`hand_raised_sequence`, and `calls` receives a monotonic per-call counter. A
raise transaction locks the call, increments the counter, and assigns its value
to the active participant. A lower clears the value. The current queue is the
active participants ordered by that sequence, with the displayed position
derived as the one-based row number.

The service exposes an idempotent `SetCallHandRaised` WebSocket command and
returns the complete ordered queue in its acknowledgement. Each real mutation
also appends a durable `CallRaisedHandsChanged` event containing the complete
queue. Existing ordered event delivery, replay, and deduplication therefore
remain the synchronization mechanism rather than adding a LiveKit-only state
path.

The queue is included in active-call bootstrap data and the join-token response
so participants joining an active call receive a snapshot immediately. A client
keeps its position during a transient LiveKit reconnect while its participant
record remains active. A confirmed leave clears the raised hand and emits the
recomputed queue. Rejoining after a confirmed leave starts unraised; raising
again receives the newest sequence and joins the end of the queue.

## UI

Add one toggle to the existing expanded call-control bar. Its title and
accessible label change between `Raise hand` and `Lower hand`, it exposes
`aria-pressed`, and it is disabled only while its request is pending. Local,
remote, and pinned participant presentations display a hand badge with the
derived queue number. The minimized dock and the overall layout stay unchanged.

## Scope and Verification

- Add the schema migration, protocol messages/event, server mutation and
  participant-leave cleanup.
- Reuse the existing WebSocket request correlation and sequenced event replay
  path; hydrate the frontend from snapshots and full queue events.
- Add service/integration tests for order, idempotence, lowers, leaves, and
  re-raises; add client store and CallDock tests for action state and badges.
- Run focused Go and Vitest suites plus frontend type-check/build.
