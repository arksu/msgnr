# Raise-hand snapshot sequencing

## Problem

Raise/lower acknowledgements and durable call queue events travel through
different WebSocket paths. A delayed older raised-hand event can arrive after a
successful lower-hand acknowledgement and restore a stale numbered badge.

## Decision

Use the durable workspace-event sequence as the queue snapshot version.

- `SetCallHandRaisedResponse` includes the current durable queue event
  sequence, including for an idempotent command.
- The chat store tracks the latest queue sequence for each call.
- Acknowledgement and realtime snapshots update a queue only when their
  sequence is at least the version already applied for that call.
- Bootstrap uses its existing atomic snapshot watermark as the queue baseline
  and retains a local queue only when its acknowledgement is newer.
- Bootstrap snapshots use their existing global watermark; the unversioned join
  snapshot remains initial state and cannot replace a versioned local queue.

## Edge cases

No-op commands do not add duplicate durable events. Their acknowledgement uses
the latest durable queue sequence, so it remains safe to apply after retries or
lost acknowledgements. Reconnect/bootstrap still supplies the current queue.

## Verification

Cover a lower-hand acknowledgement followed by an older raised event, then a
newer lowered event. Verify the badge remains absent and queue positions stay
authoritative.
