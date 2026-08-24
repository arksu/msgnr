# Tauri Chat Reliability, Performance, and Annotation Stabilization

## Goal

Make the packaged Tauri client recover visibly and automatically from desktop
transport failures, keep chat timelines bounded under long histories and media,
and prevent the screen-annotation overlay from flooding native IPC or blocking
the desktop UI.

## Scope

- Preserve optional deployment path prefixes in the configured desktop backend
  URL for both HTTP and WebSocket routes.
- Make initial, pre-open, and resume-related transport failures enter the
  existing reconnect flow instead of leaving an authenticated but stale Main
  view.
- Add bounded request policies for metadata and authentication requests without
  imposing short transfer limits on uploads or attachment downloads.
- Remove full WebSocket payload logging from production hot paths.
- Bound message DOM, media work, avatar Blob URLs, and cache/persistence work.
- Stabilize the Tauri OS annotation overlay with lifecycle-safe creation,
  batching, backpressure, and deterministic teardown.
- Add privacy-safe local diagnostics and focused automated/manual verification.

## Non-goals

- Change the server chat protocol or retry unsafe mutations automatically.
- Backfill attachment derivatives or alter message content.
- Change the product rule for whether screen sharing continues after the main
  window is hidden to tray.
- Configure or publish a production Tauri updater feed. Build/version
  attribution is included, but updater infrastructure remains deployment work.

## Chosen Architecture

### Transport and request recovery

The desktop backend URL is a deployment base URL in the form
`https://host[/prefix]`. A single URL joining helper preserves the prefix when
constructing the WebSocket endpoint:

- `https://host` becomes `wss://host/ws`.
- `https://host/prefix` becomes `wss://host/prefix/ws`.

The existing Main/cache-first experience stays in place. When an initial
WebSocket attempt fails before `onopen`, or the foreground connect deadline
expires, the session orchestrator starts the existing deduplicated reconnect
loop. Authentication failures remain owned by the authentication flow and do
not create a parallel transport retry loop.

Focus, `visibilitychange` to visible, and `online` trigger one single-flight
transport verification request. It uses the correlated transport heartbeat;
success is a no-op and failure invalidates the socket through the existing
reconnect path. Native tray events are added only if packaged-app validation
shows that regular DOM focus/visibility events are not delivered on restore.

Metadata/authentication requests receive explicit deadlines. Conversation
history, login, and refresh failures clear their in-flight state and reuse
existing error/recovery paths. Uploads and attachment downloads receive
separate, explicit longer transfer policies rather than inheriting a short
global timeout. Timed-out mutations are never replayed automatically.

### Virtual message timelines and media lifetime

A reusable virtual message-timeline primitive renders only the viewport plus a
pixel overscan window. It is used by the primary chat, pinned conversation
workspaces, and thread workspaces so a pinned surface cannot retain a second
full Bubble tree.

The primitive stores measured row heights keyed by message ID and content
revision. It preserves the first visible message ID and its pixel offset while
older history is prepended. It temporarily expands the rendered range for
focused/search targets, keyboard navigation, inline editing, and media resize;
normal bottom-stick behavior remains unchanged.

Image, video, and audio previews share one bounded request queue. Video/audio
originals are requested only near the viewport or after an explicit user
action. A mounted row owns its Blob references; unmounting releases them when
there are no remaining consumers. Avatar object URLs use a bounded LRU cache.

### Main-thread and persistence work

Production WebSocket processing logs compact metadata only; full packet
normalization is development-only and cannot run on release receive/send paths.
Sync replay processes bounded chunks with yields between chunks.

History application collects changed identities and updates sender labels in a
single linear pass rather than rescanning resident messages for each history
item. Entity normalization occurs once per item. Message cache writes retain
only the latest confirmed rows before serialization. Thread-summary and message
cache persistence use coalesced, snapshot-safe flushes. Event cursors are
durably persisted before the matching server acknowledgement is sent.

### Tauri annotation overlay

The native overlay is created through a lifecycle-safe UI path rather than a
synchronous invoke command. A stateful overlay coordinator tracks generation,
target monitor, visibility, in-flight command state, and pending segments.

The coordinator shows or retargets the overlay only when the target changes;
the periodic monitor poll and each received segment cannot re-show an unchanged
window. It batches segments at a bounded frame/interval rate, permits only one
native batch invoke in flight, caps backlog, and coalesces intermediate points
under overload. Call end and monitor switches invalidate the old generation,
clear queued work, and hide/clear the matching overlay.

The overlay page accepts batches, retains a bounded time window, and performs
one draw pass per frame. Under overload, annotation fidelity degrades before
chat or call responsiveness. The Windows packaged-app matrix remains the
authoritative validation for WebView creation and IPC behavior.

## User-visible Behavior

- A failed initial or resumed connection displays the existing reconnect banner
  and retries automatically; it never silently appears live.
- A timed-out conversation request clears the loading overlay, retains cached
  messages if present, and permits retry without restarting the app.
- Scrolling older history keeps the same visible message in place; focused,
  searched, editable, and keyboard-targeted messages are mounted on demand.
- Media loads only when useful, and failed media remains accessible as an
  attachment action.
- Annotation overload may coalesce drawing points, but must not freeze the
  main chat or call controls.

## Diagnostics

Diagnostics are bounded, sampled, and content-free. They may record application
build ID, platform, transport state transitions, close category, heartbeat and
request durations, timeout category, mounted-row/media counts, cache flush
duration, annotation queue depth, and slow native command duration. They must
not record tokens, message bodies, full URLs, attachment names, or drawing
coordinates.

## Verification

### Automated

- Endpoint tests cover root and path-prefixed desktop bases, protocol changes,
  and invalid credentials/query/fragment input.
- Session tests cover pre-open failure, foreground deadline, no auth-retry loop,
  visible/focus/online single-flight transport verification, and successful
  recovery reset.
- HTTP/history tests cover timeout/abort cleanup, late-response suppression,
  and retry.
- Release-build tests assert that full packet normalization is absent from the
  production hot path.
- Store/component tests cover replay chunking, cursor-before-ack ordering,
  coalesced persistence, virtual prepend anchoring, variable media height,
  focused-target expansion, pinned/thread isolation, media queue priority, and
  Blob URL cleanup.
- Call-store/overlay tests cover one show per target, bounded batches/backlog,
  stale generation suppression, monitor switching, and teardown.

### Manual packaged-app matrix

Test Tauri against the same account/backend as web on macOS and, as a priority,
Windows:

1. Failed WSS upgrade with successful HTTP login.
2. Tray hide, sleep or network/VPN switch, then restore.
3. Long history with media, pinned conversations, and threads.
4. Sustained multi-drawer annotation, monitor switching, and call teardown.

Acceptance requires no silent disconnected Main view, no permanently stuck
conversation loader, bounded mounted rows/media work during long scrolling,
and bounded overlay IPC/backlog while the chat remains responsive.

## Implementation Order

1. Transport URL/reconnect/deadline correctness and focused tests.
2. Production logging, persistence, and linear history processing.
3. Shared media queue/lifetime bounds and virtual timeline primitive across all
   message surfaces.
4. Annotation lifecycle, batch IPC, overlay rendering, and native tests.
5. Full build and packaged-app smoke matrix with build/version attribution.
