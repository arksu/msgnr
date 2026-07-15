# Outbound WebSocket Recovery Design

## Problem

An unstable network can leave the browser WebSocket locally `OPEN` while the
client-to-server direction no longer works. The server can still independently
fan out inbound events, so a user can switch conversations and receive messages
but cannot send one. `socket.send()` only confirms that the browser accepted
the bytes locally; it does not confirm backend delivery.

Today, the client sends a one-way presence heartbeat and treats a missing
`SendMessageAck` as a failed message after 15 seconds. Neither condition
invalidates the stale transport, so the reconnect banner and retry loop never
start. Retrying then sends through the same unusable outbound path.

## Goals

- Detect a half-open connection even while server-to-client events continue.
- Show the existing reconnect banner and enter the existing reconnect/bootstrap
  flow without requiring a user click.
- Preserve and automatically resend ordinary plaintext messages that were
  accepted locally but not acknowledged.
- Preserve idempotency, including attachments, entities, and thread replies.
- Keep encrypted-DM plaintext and cryptographic material out of the persistent
  offline queue.

## Design

### Round-trip transport heartbeat

Add a transport-heartbeat request/acknowledgement pair to the WebSocket
protocol and advertise it through a new feature capability. After auth, a
client whose server advertises that capability sends a correlated probe
immediately and every 30 seconds. Each probe has a 15-second response deadline.

The server responds through its normal single writer goroutine using the
incoming request and trace IDs. A missing correlated acknowledgement—not merely
the absence of inbound traffic—causes the client to invalidate the active
transport. The existing session orchestrator then sets its reconnecting state,
which makes `ConnectionBanner` visible, and performs reconnect plus
bootstrap/sync recovery.

The capability keeps a rolling deployment safe: an older server does not
advertise it, so a newer client does not wait for an acknowledgement it cannot
receive. The existing one-way presence heartbeat remains responsible for
presence leases; the new heartbeat has no presence side effect.

### Message delivery recovery

When any ordinary plaintext message has waited 15 seconds for a
`SendMessageAck`, the chat store will synchronously collect every currently
`sending` plaintext conversation and thread message. Before invalidating the
transport, it will:

- change each message to `queued`;
- retain its original `client_msg_id`, body, entities, attachment IDs, and
  thread-root ID; and
- enqueue that exact payload in the existing durable outbound queue.

The session transport-drop handler uses the same collection step for a detected
heartbeat failure or a native socket close. This ensures an in-flight message
is not lost when the heartbeat detects the failure before its own send timer
expires.

Once the existing reconnect flow reaches the queue-flush stage, it resends the
same client message IDs. The backend already deduplicates messages by
conversation, sender, and client message ID. A message that committed before
its acknowledgement was lost therefore returns a deduplicated acknowledgement;
a message that never reached the backend is created once. The client
reconciliation path will remove an optimistic duplicate if a bootstrap or
realtime event already supplied the confirmed message before that acknowledgement
arrives.

### Encryption boundary

This automatic replay applies only to plaintext messages. Encrypted DMs must
not enter the generic offline queue because it persists a message body and
replays a plaintext `SendMessageRequest`. A timed-out encrypted send may still
force transport recovery, but it remains failed until a separate E2EE-safe,
in-memory re-encrypt-and-retry design is implemented.

## Error Handling

- Only one pending transport probe may be active at a time. Response, socket
  close, reset, or explicit invalidation cancels its timer.
- A probe timeout or send-ack timeout invalidates a live-looking transport once;
  it must not create parallel reconnect loops.
- The transport-drop path queues plaintext sends before scheduling reconnect, so
  `AUTH_COMPLETE` cannot flush an incomplete queue.
- Failed protocol requests and ordinary server validation errors remain message
  failures rather than being treated as a transport outage.
- Reconnect repeats are safe because every replay keeps the original client
  message ID and the backend is idempotent for that ID.

## Verification

Focused automated coverage will prove that:

- a client receiving inbound events but no heartbeat acknowledgement invalidates
  the transport and starts the reconnect flow;
- a timely heartbeat acknowledgement cancels the watchdog;
- a missing message acknowledgement queues all concurrent plaintext sends
  before reconnect, preserving thread/attachment/entity metadata;
- reconnect flush resends the original IDs and server deduplication leaves one
  visible confirmed message;
- the connection banner displays while recovery is active; and
- encrypted messages never enter the plaintext offline queue.
