# ADR: Progressive Web App for Msgnr

**Status:** Proposed  
**Date:** 2026-03-11  
**Deciders:** Project team  

---

## Context

Msgnr is a team messenger built with Vue 3 + Vite (frontend) and Go (backend). It currently runs as a plain SPA served over HTTPS. Users access it via browser tabs. There is no installability, no push notifications when the tab is closed, no offline resilience, and no app icon on device home screens.

Users expect a messenger to behave like a native app: always reachable, showing notifications for new messages, and launching instantly. The project plans a Tauri desktop client alongside the web/PWA client.

The original requirements document (`docs/plans/pwa.md`) defines four architectural layers: App Shell, Realtime, Push, and Desktop-ready.

---

## Decision

We will implement a Progressive Web App using `vite-plugin-pwa` (Workbox-based) in 6 phases, adding installability, service worker caching, IndexedDB local storage, Web Push notifications, a platform abstraction layer, and resilience polish.

---

## Architectural Decisions

### AD-1: vite-plugin-pwa over manual Workbox

**Decision:** Use `vite-plugin-pwa` for service worker generation.

**Rationale:**
- First-class Vite integration — generates SW at build time aligned with chunk hashes
- Handles precache manifest automatically from build output
- Provides `virtual:pwa-register/vue` for ergonomic SW registration in Vue
- Workbox strategies configurable declaratively in `vite.config.ts`
- Active maintenance and wide adoption in the Vue ecosystem

**Alternatives considered:**
- Manual Workbox config: more control but significantly more boilerplate and build pipeline complexity
- Custom SW from scratch: maximum flexibility but no precache manifest generation, no strategy abstractions

---

### AD-2: Prompt-to-reload update strategy

**Decision:** Use `registerType: 'prompt'` — show a banner when a new SW is available, let the user decide when to reload.

**Rationale:**
- A messenger has live state (open conversations, draft text, ongoing calls). Silent auto-reload would lose that context.
- Prompt gives users control over when the interruption happens.
- More predictable than `autoUpdate` which can cause subtle state issues during navigation.

**Tradeoff:** Users on old versions until they accept the update. Acceptable for a messenger where the server is the source of truth for all data.

---

### AD-3: IndexedDB via Dexie.js (not raw IDB or idb)

**Decision:** Use Dexie.js as the IndexedDB wrapper.

**Rationale:**
- Full TypeScript support with typed tables
- Promise-based API (no callback hell of raw IDB)
- Built-in versioning and migration support
- Compound indexes and efficient range queries
- Small footprint (~28KB min+gz)
- Battle-tested in production PWAs

**Alternatives considered:**
- `idb` (Jake Archibald): thinner wrapper but no schema versioning or typed tables out of the box
- Raw IndexedDB API: too verbose, error-prone cursor management
- `localForage`: localStorage-like API, doesn't expose IndexedDB's multi-key query capabilities

---

### AD-4: Minimal IndexedDB cache (50 messages/conversation)

**Decision:** Cache only the last 50 messages per conversation, not full history.

**Rationale:**
- The app is online-first. The WS bootstrap provides the authoritative snapshot.
- 50 messages per conversation is enough to show a meaningful "instant start" before the server sync completes.
- Larger caches increase IndexedDB quota risk on mobile (especially iOS with ~50MB soft limit per origin).
- Reduces complexity of cache invalidation (fewer conflict scenarios).
- Messages beyond the cache window are fetched via HTTP history API on scroll.

**Data NOT cached:** presence, typing indicators, active call state, access control decisions. These are ephemeral and server-authoritative.

---

### AD-5: Messages NOT cached in Service Worker HTTP cache

**Decision:** Message API responses (`/api/messages/*`) are NOT cached by the service worker. Messages are stored in IndexedDB by application code.

**Rationale:**
- Messages are mutable (reactions, edits, deletions) — HTTP cache would serve stale data.
- The app already has a real-time sync protocol (event-sourced via `workspace_events`) that handles consistency.
- IndexedDB provides structured queries (by conversation, by seq range) that HTTP cache cannot.
- HTTP-caching message list endpoints risks showing messages the user no longer has access to.

**SW caches:** App shell (HTML/JS/CSS), fonts, icons, avatar images, attachment thumbnails.
**App caches (IndexedDB):** Conversations, messages, drafts, outbound queue, user profile.

---

### AD-6: Web Push with active-session skip

**Decision:** The backend sends push notifications only when the user has NO active WebSocket session.

**Rationale:**
- If the user has an open tab with a live WS connection, they already receive real-time events and in-app notifications. Sending a push notification on top of that creates annoying duplicates.
- The WS server (`ws.Server`) already tracks connected sessions per user. The push delivery service checks this before sending.
- If the WS drops and the user has no active session, push kicks in — this is the desired behavior.

**Edge case:** If the WS is mid-reconnect (5s reconnect interval), the user briefly has no active session. The push may fire for messages in that gap. This is acceptable — a slightly eager notification is better than a missed one.

---

### AD-7: VAPID keys in environment variables

**Decision:** Store VAPID public/private keys in `.env` alongside other secrets (JWT_SECRET, LIVEKIT keys).

**Rationale:**
- Consistent with existing secret management approach (Viper + `.env`)
- VAPID keys are generated once and never change (unless intentionally rotated, which invalidates all subscriptions)
- No need for a separate key management system for a single-server deployment

**Key generation:** One-time via `webpush.GenerateVAPIDKeys()` or `web-push generate-vapid-keys` CLI.

---

### AD-8: Platform abstraction layer for PWA and Tauri

**Decision:** Introduce a `PlatformAdapter` interface that abstracts notifications, system tray, window management, runtime endpoint selection, and secure storage behind a pluggable implementation. Ship concrete adapters for **PWA and Tauri**.

**Rationale:**
- The project ships one desktop runtime (Tauri). Without an abstraction, notification code, badge updates, tray management, backend endpoint selection, and window controls would be scattered across components with platform-specific branching.
- A thin adapter interface (`PwaAdapter`, `TauriAdapter`) keeps feature code shared and isolates platform-only concerns.
- The interface is intentionally minimal — only methods that differ between PWA and desktop. Shared code (Vue components, Pinia stores, WS protocol) stays untouched.
- Desktop adapters are lazy-imported via dynamic `import()` so the PWA build never bundles Tauri code.
- Runtime detection uses `window.__TAURI__` set by the desktop shell — no user-agent sniffing.

**What this does NOT do:** It does not abstract the entire app. Vue components, routing, stores, and the WS layer remain platform-agnostic by nature. The adapter only covers the delta: notifications, system integration, and window control.

**Runtime strategy:** Tauri is the desktop runtime. The shared `PlatformAdapter` interface ensures feature parity between web/PWA and desktop without duplicating business logic.

---

### AD-9: BroadcastChannel for multi-tab coordination

**Decision:** Use the `BroadcastChannel` API to coordinate between multiple open tabs.

**Rationale:**
- Without coordination, multiple tabs each open their own WS connection, causing duplicate message handling and conflicting badge counts.
- `BroadcastChannel` is supported in all modern browsers (including Safari 15.4+).
- Leader election (one tab owns the WS) reduces server load and prevents duplicate push subscriptions.
- Logout in one tab propagates to all tabs.

**Alternatives considered:**
- `SharedWorker`: more powerful but significantly more complex, poor debugging experience
- `localStorage` events: works but is a hack (write + listen for `storage` event), no structured messaging
- Service Worker `postMessage`: viable but adds coupling between SW and app logic

---

### AD-10: iOS PWA push handled via install-first UX flow

**Decision:** On iOS Safari, show a guided "Add to Home Screen" flow before offering push notification permission.

**Rationale:**
- iOS Web Push only works for web apps added to the Home Screen (not in regular Safari tabs). This is a WebKit platform constraint.
- Requesting Notification permission in a regular Safari tab will fail silently or be denied.
- A guided UX flow (modal with screenshots/steps) sets correct expectations and increases the chance of successful push setup.
- Feature detection (not user-agent sniffing) determines when to show this flow.

---

### AD-11: Replace `is_muted` boolean with `notification_level` enum

**Decision:** Drop the dormant `channel_members.is_muted` boolean column and replace it with `notification_level SMALLINT` supporting three levels: ALL (0), MENTIONS_ONLY (1), NOTHING (2).

**Rationale:**
- The existing `is_muted` infrastructure is completely inert — no API to toggle it, no server logic reads it for any purpose beyond forwarding the always-false value, and the frontend discards it. Activating it as a boolean would be immediately insufficient because users expect Slack-style per-channel notification granularity (all / mentions only / nothing), not just on/off.
- A single `SMALLINT` column with an enum mapping is simpler and more extensible than a boolean. Adding future levels (e.g., `URGENT_ONLY`) is a matter of adding an enum value — no schema change needed.
- Proto field 6 on `ConversationSummary` changes from `bool is_muted` to `NotificationLevel notification_level`. This is a breaking wire change, but since `is_muted` is always `false` (value `0`) in production, the numeric representation maps correctly to `ALL = 0`. Server and client must be deployed together.

**Alternatives considered:**
- Activate `is_muted` as-is (boolean): insufficient for mentions-only use case, would require another migration soon
- Separate `notification_preferences` table: over-engineered for three levels; adds a JOIN to every notification-delivery query
- Keep `is_muted` and add `notification_level`: redundant columns, confusing semantics

**Tradeoff:** Proto field 6 type change requires coordinated server+client deploy. Acceptable given the field has never carried meaningful data.

---

### AD-12: Server-side notification-level enforcement

**Decision:** The server enforces notification levels at event creation time. The server decides whether to create a `NotificationAdded` event and whether to send a push notification based on `channel_members.notification_level`. The client does NOT filter notifications locally.

**Rationale:**
- Notification suppression must be authoritative. If the client were responsible for filtering, a push notification would still arrive (the SW handles push independently of app code), creating a contradiction where the user set "nothing" but still receives push.
- Server-side enforcement means the push delivery service (Phase 4) simply checks notification level before sending — no separate client-side filtering needed.
- Unread counter increments are also server-controlled per notification level: `NOTHING` never increments unread, `MENTIONS_ONLY` only increments for qualifying messages.
- This is consistent with the project's server-authoritative principle (per `internal/AGENTS.md`).

**Tradeoff:** Changing notification level requires a round-trip to the server. This is acceptable — notification settings are changed infrequently (seconds vs. milliseconds don't matter).

---

### AD-13: Pending message UX with explicit state machine

**Decision:** Replace the boolean `Message.pending` field with a `sendStatus` enum (`'sending' | 'queued' | 'failed' | undefined`) and provide visual states, timeout detection (15s), retry, and discard for each state.

**Rationale:**
- The current UX is minimal: italic gray "sending..." text and dimmed body. There is no failure state, no retry mechanism, no timeout detection, and no visual distinction between "actively sending" vs "queued because offline".
- Users of messengers (Slack, Telegram, WhatsApp) expect clear feedback on message delivery status: a spinner while sending, a queue indicator when offline, an error with retry when failed.
- The 15-second timeout catches WS-level failures that don't produce explicit error events (e.g., connection silently dropped mid-send).
- Retry and discard actions give users control over failed messages rather than leaving them in a permanent "sending..." limbo.

**Alternatives considered:**
- Boolean `pending` + separate `failed` boolean: two booleans with invalid combinations (pending=true + failed=true is meaningless)
- Numeric status codes: less readable than string literal union in TypeScript
- No timeout (rely only on WS error events): WS drops don't always produce error events within a reasonable window

**Tradeoff:** The state machine adds complexity to `MessageBubble.vue` and the chat store. This is justified by the significant UX improvement for a messenger app where message delivery confidence is a core concern.

---

### AD-14: Tauri-only desktop runtime strategy

**Decision:** Plan for Tauri as the only desktop runtime for v1. Web/PWA and Tauri share the same Vue codebase via the `PlatformAdapter` interface.

**Rationale:**
- Tauri provides a small binary footprint and native integrations needed for production desktop features (tray, keyring, updater, notifications).
- Maintaining one desktop runtime keeps scope focused for GA while preserving shared business logic through the adapter.
- The adapter layer remains thin relative to shared Vue/Pinia/WS code.

**Alternatives considered:**
- Electron + Tauri dual runtime: increases implementation and maintenance cost for no immediate GA value
- Electron only: larger binary and runtime overhead
- No desktop runtime at GA: does not meet the planned GA client matrix (web/PWA + macOS desktop)

**Tradeoff:** Tauri plugin and command-surface maturity still requires careful testing, but this is acceptable given the reduced scope and shared UI/business layer.

---

### AD-15: Production v1 scope constraints

**Decision:** Production v1 targets self-hosted single-instance deployments with local auth only, minimal compliance scope, and no formal SLO target.

**Rationale:**
- Matches current system architecture and operational model (single authority server).
- Keeps GA scope focused on Chat + Calls + Tasks plus desktop readiness.
- Defers enterprise identity federation and advanced compliance workflows to later phases.

---

## Consequences

### Positive
- App becomes installable on all major platforms (desktop + mobile)
- Users receive push notifications when the app is closed
- App shell loads instantly even on unreliable networks
- Cached conversations provide meaningful "instant start" on cold launch
- Platform abstraction keeps web/PWA and Tauri codepaths clean and maintainable
- Badge API provides unread count on app icon (where supported)
- Per-channel notification levels (ALL/MENTIONS_ONLY/NOTHING) give users Slack-style control over notification noise
- Dormant mute infrastructure is fully activated — no more dead code in schema/proto
- Pending message UX provides clear delivery feedback (sending/queued/failed) with retry and discard

### Negative
- Service worker adds a caching layer that can cause subtle staleness bugs if misconfigured
- IndexedDB adds data management complexity (cache invalidation, quota management, migration)
- Push notification backend is a new subsystem to maintain (subscription lifecycle, delivery, error handling)
- iOS push limitations require separate UX flow and testing
- Multi-tab coordination via BroadcastChannel adds complexity to the WS lifecycle
- Notification level enforcement adds a query to the push delivery hot path (mitigated by batching)
- Proto field 6 type change requires coordinated server+client deploy
- Tauri-native command/plugin surface adds desktop-specific test and release overhead

### Neutral
- Build output increases slightly (SW + Workbox runtime ~20KB gzipped)
- DB changes: `channel_members.is_muted` replaced with `notification_level`; one new table (`push_subscriptions`)
- Two new npm dependencies (`vite-plugin-pwa`, `dexie`) — both well-maintained, moderate size
- One new Go dependency (`webpush-go`) — small, focused library
- Estimated effort increases from 10-15 to 15-22 days due to mute/notification-level activation, pending UX upgrade, and dual-desktop skeletons

---

## Compliance with Working Rules

Per `internal/AGENTS.md`:

1. **Protocol-first:** Push notification payload is a new server-to-client channel, but push payloads are plain JSON, separate from the `Envelope` message format. The proto **does** change for notification levels: field 6 on `ConversationSummary` changes from `bool is_muted` to `NotificationLevel notification_level`, and new command/response/event messages are added for `SetNotificationLevel`. These are additive changes (new enum, new messages) plus one field type change on a field that has never carried non-zero data.

2. **DB writes server-authoritative:** IndexedDB is a read cache and outbound queue only. The server remains the source of truth for messages, unread counts, notification levels, and access control. IndexedDB is never trusted over server data. Notification level enforcement is server-side — the client does not filter notifications locally.

3. **Event ordering via `event_seq`:** The IndexedDB message cache stores `seq` but does not participate in event ordering or recovery. That remains server-side via `workspace_events.event_seq` and the existing `SyncSince` protocol.

4. **WS auth before domain payloads:** Push delivery is independent of WS auth. Push is sent via HTTP (Web Push protocol), not through the WS connection. The WS handshake remains unchanged. The new `SetNotificationLevel` command goes through the authenticated WS connection like all other domain commands.

---

## References

- `docs/plans/pwa.md` — original requirements document
- [vite-plugin-pwa docs](https://vite-pwa-org.netlify.app/)
- [Web Push Protocol (RFC 8030)](https://datatracker.ietf.org/doc/html/rfc8030)
- [Workbox strategies](https://developer.chrome.com/docs/workbox/modules/workbox-strategies)
- [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [MDN: Badging API](https://developer.mozilla.org/en-US/docs/Web/API/Badging_API)
- [WebKit: Web Push for Web Apps on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
