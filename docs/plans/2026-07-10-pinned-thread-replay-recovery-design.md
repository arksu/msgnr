# Pinned Thread Replay Recovery Design

## Problem

Pinned thread headers can show a persisted reply count while the separate
thread-message cache is empty. Opening a thread sends a one-shot WebSocket
subscription, but the send result is currently discarded. If the socket is not
open, or synchronization is still recovering, the request can be lost and the
active thread is not resubscribed when the connection becomes live again.

The UI then presents an empty thread despite knowing that replies exist.

## Design

Thread replay subscriptions will become observable and recoverable:

- `sendSubscribeThread` will return whether the request reached the open
  WebSocket.
- The chat store will track replay loading/error state per thread root.
- Whenever synchronization reaches `LIVE_SYNCED`, the active visible thread
  will subscribe again using the existing cache-aware cursor.
- A replay response whose confirmed cached reply count is still below the
  server reply count will trigger one automatic retry from cursor `0`.
- If the retry remains incomplete, the workspace will show an explicit retry
  action instead of claiming that the thread has no replies.
- Manual retry resets the bounded recovery attempt and requests a full replay.

Thread caches remain keyed by root message ID, so responses for inactive or
rapidly switched pinned threads can still populate their own caches without
overwriting the active thread.

## Error Handling

A failed WebSocket send remains in a loading state and is retried when realtime
sync becomes live. Incomplete server responses receive one automatic full
replay retry to avoid an unbounded request loop. A second incomplete response
changes the thread to a user-retryable error state.

## Verification

Add focused tests proving that:

- the WebSocket subscription reports send success/failure;
- an active thread resubscribes when synchronization becomes live;
- an incomplete response retries from cursor `0` only once;
- rapid switching keeps responses isolated by thread root; and
- the workspace renders loading and retry states when a nonzero reply count has
  no loaded messages.
