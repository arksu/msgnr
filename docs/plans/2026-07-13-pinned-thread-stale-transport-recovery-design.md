# Pinned Thread Stale Transport Recovery Design

## Problem

After a browser tab has been inactive for a long period, its WebSocket can
remain locally `OPEN` and `LIVE_SYNCED` even when the upstream connection is no
longer usable. Reopening a pinned thread sends `SubscribeThread`, but the
browser accepting `socket.send()` does not mean that a server response will
arrive.

The replay cache may have been cleared during bootstrap while the thread
summary still records its reply count. Because the current replay path only
recovers when a response is incomplete, a lost response leaves the workspace in
`loading` indefinitely and shows an empty thread beneath a nonzero reply count.

## Design

- Track a 15-second response watchdog for each thread replay request.
- Reset that watchdog whenever a newer replay request is sent for the same
  thread, and clear it when its replay response arrives.
- Let a watchdog expiry affect only the still-visible active thread it was
  sent for. A stale response or a thread that has since been closed must not
  reconnect the application.
- Add an explicit WebSocket transport-invalidation operation. It closes the
  active connection while preserving the normal transport-drop callback, so the
  session orchestrator performs its existing reconnect, bootstrap, and
  `LIVE_SYNCED` recovery sequence.
- Reuse the existing active-thread recovery after realtime sync to request the
  full replay from cursor `0` after reconnect. The existing one-time
  received-but-incomplete retry remains separate from this no-response path.

## Error Handling

The response watchdog is scoped to a visible pinned workspace and is cancelled
on a valid replay response, thread switch/close, or store reset. A timeout
invalidates an otherwise healthy-looking transport once; the normal connection
close handler owns reconnection scheduling and rejects other pending requests.
This avoids local resend loops on a zombie socket.

## Verification

Focused store tests will prove that:

- an open/live WebSocket with no `SubscribeThreadResponse` is invalidated after
  the watchdog deadline;
- a timely replay response cancels the watchdog;
- normal reconnect and `LIVE_SYNCED` recovery resubscribes the active thread
  from cursor `0`; and
- existing incomplete-response recovery still stays bounded.
