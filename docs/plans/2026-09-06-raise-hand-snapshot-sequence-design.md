# Raise-hand snapshot sequencing

## Problem

Raise/lower acknowledgements and durable call queue events travel through
different WebSocket paths. A delayed older raised-hand event can arrive after a
successful lower-hand acknowledgement and restore a stale numbered badge.

## Decision

Use the durable workspace-event sequence as the queue snapshot version.

- `SetCallHandRaisedResponse` includes the sequence of the event written for a
  state-changing command.
- The chat store tracks the latest queue sequence for each call.
- Acknowledgement and realtime snapshots update a queue only when their
  sequence is at least the version already applied for that call.
- Existing bootstrap and join snapshots remain unversioned initial state; any
  sequenced event supersedes them.

## Edge cases

No-op commands do not add duplicate durable events. Their acknowledgement does
not replace a versioned local queue. Reconnect/bootstrap still supplies the
current queue, and normal raise/lower actions always have a new sequence.

## Verification

Cover a lower-hand acknowledgement followed by an older raised event, then a
newer lowered event. Verify the badge remains absent and queue positions stay
authoritative.
