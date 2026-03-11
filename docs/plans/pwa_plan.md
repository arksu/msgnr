# Msgnr PWA Implementation Plan

## Overview

Convert Msgnr from a plain Vue 3 SPA into a fully installable Progressive Web App with push notifications, offline resilience, badge support, and a desktop-ready abstraction layer for future Electron/Tauri builds.

**Current state:** Zero PWA infrastructure. No manifest, no service worker, no IndexedDB, no push, no icons (except a source PNG at `docs/msgnr.png`). All client persistence is `localStorage`.

**Target state:** Installable PWA on Chrome, Edge, Safari (desktop + mobile), Android, iOS (home screen). Push notifications independent of open tab. Offline-resilient app shell. Local message cache in IndexedDB. Abstraction layer ready for Electron/Tauri.

---

## Phase 1: App Shell & Installability

**Goal:** App installs from browser, opens standalone, loads instantly.

### 1.1 Generate Icon Set

- Source: `docs/msgnr.png` (high-res logo)
- Generate via `pwa-asset-generator` or `sharp` script:
  - `favicon.ico` (16x16, 32x32 multi-size)
  - `favicon.svg` (vector, already referenced in `index.html`)
  - `pwa-192x192.png`
  - `pwa-512x512.png`
  - `pwa-maskable-192x192.png`
  - `pwa-maskable-512x512.png`
  - `apple-touch-icon-180x180.png`
  - `badge-72x72.png` (monochrome, for notification badge)
- Place all in `web/public/icons/`

### 1.2 Web App Manifest

`vite-plugin-pwa` generates the manifest from config. Key values:

```json
{
  "name": "Msgnr",
  "short_name": "Msgnr",
  "description": "Team messenger",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#1a1d21",
  "background_color": "#1a1d21",
  "icons": [
    { "src": "/icons/pwa-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/pwa-512x512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/pwa-maskable-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/pwa-maskable-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 1.3 Update `index.html`

- Add `<meta name="theme-color" content="#1a1d21">`
- Add `<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180x180.png">`
- Add `<meta name="apple-mobile-web-app-capable" content="yes">`
- Add `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- Fix missing `favicon.svg` (currently referenced but file doesn't exist)

### 1.4 Install & Configure `vite-plugin-pwa`

- `npm install -D vite-plugin-pwa`
- Add `VitePWA` plugin to `web/vite.config.ts`:

```ts
import { VitePWA } from 'vite-plugin-pwa'

VitePWA({
  registerType: 'prompt',        // user-controlled update
  includeAssets: ['favicon.svg', 'icons/*.png'],
  manifest: { /* as above */ },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    // Runtime caching configured in Phase 2
  },
})
```

### 1.5 SW Registration + Update Prompt

- Create `web/src/composables/usePwaUpdate.ts`:
  - Import `useRegisterSW` from `virtual:pwa-register/vue`
  - Expose `needRefresh`, `updateServiceWorker()` reactive state
  - When `needRefresh` is true, show a non-blocking banner: "New version available — click to update"
- Add `<PwaUpdateBanner />` component to `App.vue`

### 1.6 Verify Installability

- Lighthouse PWA audit passes core installability checks
- Test: Chrome install prompt, Edge install, Safari "Add to Home Screen"

**Deliverables:**
- Icon set in `web/public/icons/`
- `vite-plugin-pwa` configured in `vite.config.ts`
- `PwaUpdateBanner.vue` component
- `usePwaUpdate.ts` composable
- Updated `index.html` with meta tags

---

## Phase 2: Service Worker Caching Strategy

**Goal:** App shell loads from cache even on flaky network. API and media cached appropriately.

### 2.1 Precache (Workbox Generated)

Handled automatically by `vite-plugin-pwa` `globPatterns`:
- All JS chunks (including `vendor-core`, `vendor-livekit`, `vendor-emoji`, `vendor-proto`)
- CSS, HTML shell
- Icons, fonts
- RNNoise WASM files in `public/`

Consider excluding `vendor-livekit` and `vendor-emoji` from precache (large, lazy-loaded) — use runtime cache `StaleWhileRevalidate` for those instead.

### 2.2 Runtime Cache Strategies

Add to `workbox.runtimeCaching` in vite config:

| URL Pattern | Strategy | Rationale |
|---|---|---|
| `/api/auth/profile` | `NetworkFirst` (30s timeout) | User profile; show cached on flaky net |
| Avatar URLs (Minio presigned) | `CacheFirst` (max 200 entries, 7d expiry) | Rarely change, save bandwidth |
| Attachment thumbnails | `CacheFirst` (max 100 entries, 30d expiry) | Static media |
| `/api/messages/*` | **No SW cache** | Messages go through IndexedDB (Phase 3) |
| `/ws` | **No SW intercept** | WebSocket must not be intercepted |
| `/health`, `/ready` | **No cache** | Infrastructure endpoints |

### 2.3 Offline Fallback

- The Vue app already has reconnect UI in the session orchestrator
- Service worker catches failed navigations and serves cached `index.html` shell
- The shell renders, Vue mounts, orchestrator detects offline state, shows reconnect UI
- No separate `offline.html` needed — leverage existing app shell

### 2.4 Navigation Preload

- Enable `workbox.navigationPreload: true` for faster navigation on supported browsers
- Fallback to cache for offline

**Deliverables:**
- Runtime caching rules in `vite.config.ts`
- Offline fallback via cached app shell
- SW handles static + media caching, stays out of WS and message API paths

---

## Phase 3: IndexedDB Local Message Cache

**Goal:** Show cached conversations and messages on startup before server sync completes.

### 3.1 Choose IndexedDB Library

- Use **Dexie.js** (lightweight, Promise-based, well-typed for TS)
- `npm install dexie`

### 3.2 Database Schema

```ts
// web/src/services/db/msgnrDb.ts
import Dexie from 'dexie'

class MsgnrDB extends Dexie {
  conversations!: Table<CachedConversation>
  messages!: Table<CachedMessage>
  userProfile!: Table<CachedUserProfile>
  drafts!: Table<CachedDraft>
  outboundQueue!: Table<QueuedOutboundAction>

  constructor() {
    super('msgnr')
    this.version(1).stores({
      conversations: 'id, lastActivityAt',
      messages: 'id, conversationId, [conversationId+seq]',
      userProfile: 'id',
      drafts: 'conversationId',
      outboundQueue: '++id, createdAt',
    })
  }
}
```

### 3.3 Cache Policy

| Data | Cache | Eviction |
|---|---|---|
| User profile | 1 entry | Overwrite on fetch |
| Conversations (channels + DMs) | All | Full replace on bootstrap |
| Messages | Last 50 per conversation | LRU trim on write; delete on conversation leave |
| Drafts | Per conversation | User-managed |
| Outbound queue | Pending actions | Delete on ACK |
| Unread counters | Per conversation | Update from server events |

NOT cached (ephemeral data):
- Presence status
- Typing indicators
- Active call state
- Access control decisions

### 3.4 Integration Points

- **Startup flow** (modify `useSessionOrchestrator`):
  1. Read cached profile + conversations from IndexedDB
  2. Render UI immediately with cached data
  3. Connect WS, bootstrap, overwrite cache with server truth
  4. Mark stale items as "syncing..."

- **Message receive** (modify `chat` store):
  - On new message event: write to IndexedDB + update Pinia state
  - On message history load: write batch to IndexedDB

- **Offline queue** (upgrade `useOfflineQueue`):
  - Move from in-memory `ref<PendingOutboundMessage[]>` to IndexedDB `outboundQueue` table
  - Survives page reload / app restart
  - Flush on reconnect (existing logic preserved)

### 3.5 Migration from localStorage

- Move `auth.user` cache to IndexedDB
- Move `msgnr:thread-summaries:v1` to IndexedDB
- Keep tokens in `localStorage` (synchronous access needed for axios interceptor)
- Keep `msgnr:last-applied-event-seq` in `localStorage` (sync watermark, fast access)

**Deliverables:**
- `web/src/services/db/msgnrDb.ts` — Dexie database definition
- `web/src/services/db/cache.ts` — read/write helpers
- Modified startup flow with cache-first rendering
- Persistent offline queue
- Migration of appropriate localStorage data

---

## Phase 3A: Mute Activation & Per-Channel Notification Levels

**Goal:** Activate the existing dormant mute plumbing and extend it to Slack-style per-channel notification levels. This must land before Push (Phase 4) because push delivery logic needs notification-level awareness.

### Current State

The mute infrastructure is a skeleton:
- DB column `channel_members.is_muted BOOLEAN DEFAULT false` exists in `migrations/schema.sql`
- Proto field `ConversationSummary.is_muted` (field 6) exists and is wired through bootstrap
- `GetChannelMember` SQL query reads `is_muted`
- **No write path**: no API, no WS command, no SQL UPDATE for `is_muted`
- **No frontend consumption**: chat store ignores the field, no UI toggle or visual indicator

### 3A.1 Database: Replace `is_muted` with `notification_level`

Replace the boolean `is_muted` with a richer notification-level column:

```sql
-- Migration: alter channel_members
ALTER TABLE channel_members
  DROP COLUMN is_muted;

ALTER TABLE channel_members
  ADD COLUMN notification_level SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN channel_members.notification_level IS
  '0=ALL (every message), 1=MENTIONS (mentions + DMs only), 2=NOTHING (fully muted)';
```

Enum values (mirrored in proto and TypeScript):
| Value | Name | Behavior |
|---|---|---|
| 0 | `ALL` | Every message triggers notification (default, current implicit behavior) |
| 1 | `MENTIONS_ONLY` | Only @mentions, thread replies to own messages, DMs |
| 2 | `NOTHING` | No notifications, no unread increment, no push |

### 3A.2 Proto: Add `NotificationLevel` Enum and Commands

```proto
enum NotificationLevel {
  NOTIFICATION_LEVEL_ALL = 0;
  NOTIFICATION_LEVEL_MENTIONS_ONLY = 1;
  NOTIFICATION_LEVEL_NOTHING = 2;
}

// Replace bool is_muted in ConversationSummary
message ConversationSummary {
  // ... existing fields ...
  // field 6 changes from bool is_muted to:
  NotificationLevel notification_level = 6;
}

// New command
message SetNotificationLevelRequest {
  string conversation_id = 1;
  NotificationLevel level = 2;
}
message SetNotificationLevelResponse {
  NotificationLevel level = 1;
}

// New event (broadcast to user's other sessions)
message NotificationLevelChangedEvent {
  string conversation_id = 1;
  NotificationLevel level = 2;
}
```

**Migration note:** Proto field 6 changes from `bool is_muted` to `NotificationLevel notification_level`. Since `NOTHING = 2` (truthy int) and `ALL = 0` (falsy), this is NOT wire-compatible with the old bool. However, since `is_muted` is always `false` today (no write path exists), all existing data has value `0` which maps correctly to `ALL`. No data migration needed — just regenerate proto code.

### 3A.3 Backend: SQL + Service

New sqlc query:
```sql
-- name: SetNotificationLevel :exec
UPDATE channel_members
SET notification_level = $3
WHERE channel_id = $1 AND user_id = $2 AND is_archived = false;
```

Update existing queries:
- `GetChannelMember`: return `notification_level` instead of `is_muted`
- Bootstrap query (`ListBootstrapConversationsPage`): return `notification_level` instead of `cm_self.is_muted`

Service layer (`internal/chat/service.go`):
- New method `SetNotificationLevel(ctx, channelID, userID, level)`:
  - Validate membership
  - Execute `SetNotificationLevel` query
  - Emit `NOTIFICATION_LEVEL_CHANGED` event (so other sessions of the same user sync)
  - Return new level

WS handler:
- Handle `SetNotificationLevelRequest` envelope → call service → return `SetNotificationLevelResponse`
- On `NOTIFICATION_LEVEL_CHANGED` event: fan out to the user's sessions (not the whole channel)

### 3A.4 Backend: Notification-Level-Aware Delivery

Modify the server-side notification creation logic:
- Before creating a `NotificationAdded` event for a user in a channel, check `channel_members.notification_level`:
  - `ALL (0)`: always create notification
  - `MENTIONS_ONLY (1)`: create only if message @mentions the user, is a thread reply to their message, or is a DM
  - `NOTHING (2)`: never create notification, do not increment unread counter
- This affects both the in-app notification system AND push delivery (Phase 4)

### 3A.5 Frontend: Store + UI

Chat store (`web/src/stores/chat.ts`):
- Add `notificationLevel: NotificationLevel` to `Channel` and `DirectMessage` interfaces (replacing any `isMuted` traces)
- Hydrate from bootstrap `ConversationSummary.notificationLevel`
- Handle `notificationLevelChanged` event to update local state
- New action `setNotificationLevel(conversationId, level)` → sends WS command

UI components:
- **Channel header dropdown** or **sidebar context menu**: notification level selector
  - Three options with icons: "All messages", "Mentions only", "Nothing"
  - Current level shown with checkmark
- **Sidebar visual indicator**: muted icon (bell-slash or similar) next to channel name when level is `NOTHING`
- **SidebarItem.vue**: when `notification_level = NOTHING`, suppress unread badge and use dimmed text style

### 3A.6 Unread Counter Respect

When `notification_level = NOTHING`:
- Server does NOT increment unread counter for new messages in that conversation
- Server does NOT create `NotificationAdded` events
- Frontend sidebar shows no unread badge
- The conversation still receives messages via WS (user can read if they open it) but gets zero notifications

When `notification_level = MENTIONS_ONLY`:
- Server increments unread only for @mentions and thread replies to own messages
- Only those messages create `NotificationAdded` events

**Deliverables:**
- SQL migration: drop `is_muted`, add `notification_level`
- Proto changes: `NotificationLevel` enum, updated `ConversationSummary`, new request/response/event messages
- Backend: `SetNotificationLevel` service method + WS handler + notification-aware delivery
- Frontend: store integration, notification level selector UI, sidebar mute indicator

**Modified files (backend):**
- `migrations/schema.sql` — alter `channel_members`
- `api/proto/packets.proto` — new enum + messages, field 6 change
- `internal/repo/queries/channel_members.sql` — new query
- `internal/repo/queries/bootstrap.sql` — return `notification_level`
- `internal/chat/service.go` — new method
- `internal/ws/server.go` — new command handler
- `internal/bootstrap/service.go` — map `notification_level`

**Modified files (frontend):**
- `web/src/stores/chat.ts` — new field, action, event handler
- `web/src/components/AppSidebar.vue` — mute indicator
- `web/src/components/SidebarItem.vue` — suppress badge when muted

**New files (frontend):**
- `web/src/components/NotificationLevelSelector.vue`

---

## Phase 3B: Pending Message UX Upgrade

**Goal:** Replace the minimal italic "sending..." text with Slack-quality optimistic send UX: visual states for pending/failed/retry, persistent offline queue, and clear user feedback.

### Current State

- `MessageBubble.vue:36` shows `<span class="text-xs text-gray-600 italic">sending…</span>` when `message.pending` is true
- `MessageBubble.vue:122-124` dims the message body text (`text-gray-400` vs `text-gray-100`)
- `useOfflineQueue.ts` stores pending messages in-memory (lost on page reload)
- No failure state, no retry UI, no timeout detection
- No visual differentiation between "sending now" and "queued offline"

### 3B.1 Extended Message States

Replace the boolean `pending` with a richer status field:

```ts
// web/src/stores/chat.ts — Message interface
export interface Message {
  // ... existing fields ...
  sendStatus?: 'sending' | 'queued' | 'failed' | undefined  // undefined = confirmed
  failReason?: string  // human-readable error for 'failed' state
  clientMsgId?: string
}
```

State machine:
```
[user sends] → sending → [ACK received] → undefined (confirmed)
                       → [timeout 15s / error] → failed
[user sends while offline] → queued → [reconnect + flush] → sending → ...
[user clicks retry on failed] → sending → ...
[user clicks discard on failed] → (removed)
```

### 3B.2 MessageBubble Visual Upgrade

Replace the simple italic text with state-aware UI:

**Sending state** (`sendStatus === 'sending'`):
- Subtle animated spinner icon (12px) next to timestamp area
- Message body at 90% opacity (not the current gray-400 dimming)
- No italic text

**Queued state** (`sendStatus === 'queued'`):
- Clock/queue icon next to timestamp
- Tooltip: "Message queued — will send when connection is restored"
- Message body at 80% opacity
- Subtle dashed left border to distinguish from sent messages

**Failed state** (`sendStatus === 'failed'`):
- Red alert icon with exclamation mark
- Red text: "Not sent" with reason if available
- Two action buttons:
  - "Retry" — re-sends the message
  - "Delete" — removes the optimistic message
- Message body at 70% opacity with red-tinted left border

**Confirmed state** (`sendStatus === undefined`):
- Current normal rendering (no change)

### 3B.3 Timeout + Failure Detection

In the chat store / WS store:

```ts
// When sending a message, start a timeout
const SEND_TIMEOUT_MS = 15_000

function startSendTimeout(channelId: string, clientMsgId: string) {
  setTimeout(() => {
    const msg = findMessageByClientMsgId(channelId, clientMsgId)
    if (msg && msg.sendStatus === 'sending') {
      updateSendStatus(channelId, clientMsgId, 'failed', 'Message timed out')
    }
  }, SEND_TIMEOUT_MS)
}
```

WS error responses should also trigger `failed` state with the server error message.

### 3B.4 Retry + Discard Actions

```ts
// web/src/stores/chat.ts
function retryMessage(channelId: string, clientMsgId: string) {
  const msg = findMessageByClientMsgId(channelId, clientMsgId)
  if (!msg || msg.sendStatus !== 'failed') return
  updateSendStatus(channelId, clientMsgId, 'sending')
  wsStore.sendMessage(channelId, msg.body, clientMsgId, ...)
  startSendTimeout(channelId, clientMsgId)
}

function discardFailedMessage(channelId: string, clientMsgId: string) {
  const list = messages.value[channelId]
  if (!list) return
  const idx = list.findIndex(m => m.clientMsgId === clientMsgId && m.sendStatus === 'failed')
  if (idx !== -1) list.splice(idx, 1)
}
```

### 3B.5 Persistent Offline Queue (IndexedDB)

Depends on Phase 3 IndexedDB setup. Upgrade `useOfflineQueue.ts`:
- Store queued messages in IndexedDB `outboundQueue` table (survives page reload)
- On app startup: load queued messages, render them with `sendStatus: 'queued'`
- On reconnect: flush queue in order, transition each to `sendStatus: 'sending'`
- On ACK: remove from IndexedDB + set `sendStatus: undefined`

### 3B.6 Send Status in Thread Replies

Apply the same state machine to thread replies (`sendThreadReply` in chat store):
- Thread messages in `ThreadPanel.vue` show the same visual states
- Retry/discard work the same way

**Deliverables:**
- Extended `Message.sendStatus` field replacing boolean `pending`
- Upgraded `MessageBubble.vue` with spinner/queue/failed visual states
- Timeout detection (15s default)
- Retry and discard actions in chat store
- Persistent offline queue (IndexedDB, depends on Phase 3)
- Thread reply support

**Modified files:**
- `web/src/stores/chat.ts` — `Message` interface, `sendStatus` logic, retry/discard actions
- `web/src/components/MessageBubble.vue` — visual state overhaul
- `web/src/components/ChatArea.vue` — use `sendStatus` instead of `pending`
- `web/src/components/ThreadPanel.vue` — thread reply send status
- `web/src/composables/useOfflineQueue.ts` — IndexedDB-backed queue
- `web/src/stores/__tests__/chatStore.test.ts` — update tests for new states
- `web/src/components/__tests__/ChatArea.test.ts` — update tests

---

## Phase 4: Push Notifications

**Goal:** System notifications for new messages even when no tab is open.

### 4.1 Backend: VAPID Key Management

- Add config fields to `internal/config/config.go`:
  ```go
  VAPIDPublicKey  string `mapstructure:"VAPID_PUBLIC_KEY"`
  VAPIDPrivateKey string `mapstructure:"VAPID_PRIVATE_KEY"`
  VAPIDSubject    string `mapstructure:"VAPID_SUBJECT"` // mailto: or https:
  ```
- Generate VAPID key pair (one-time setup, store in `.env`)
- Add endpoint: `GET /api/push/vapid-key` — returns public key

### 4.2 Backend: Push Subscription Storage

- New SQL migration — `push_subscriptions` table:
  ```sql
  CREATE TABLE push_subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL UNIQUE,
    key_p256dh  TEXT NOT NULL,
    key_auth    TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
  ```
- API endpoints:
  - `POST /api/push/subscribe` — store subscription (upsert by endpoint)
  - `DELETE /api/push/subscribe` — remove subscription
- Implement in `internal/notifications/` (currently empty placeholder)

### 4.3 Backend: Push Delivery Service

- Use Go library: `github.com/SherClockHolmes/webpush-go`
- New service: `internal/notifications/service.go`
  - Subscribes to `events.Bus` for: `MESSAGE_CREATED`, `CALL_INVITE_CREATED`, `NOTIFICATION_ADDED`
  - For each event: look up target user's push subscriptions
  - Skip if user has an active WS session on `ws.Server` (they'll get the live event)
  - **Respect notification level (Phase 3A)**: check `channel_members.notification_level` before sending push:
    - `ALL`: send push for any message
    - `MENTIONS_ONLY`: send push only for @mentions, thread replies to own messages, DMs
    - `NOTHING`: never send push
  - Build minimal, safe payload:
    ```json
    {
      "type": "message",
      "title": "Alice",
      "body": "Hey, check this out...",
      "conversationId": "...",
      "messageId": "...",
      "tag": "conv:<conversationId>",
      "url": "/"
    }
    ```
  - Send via `webpush.SendNotification()`
  - On 410 Gone response: delete stale subscription from DB
  - Rate limit: max 1 push per conversation per 3 seconds (collapse by tag)
  - Do NOT include sensitive data in push payload (visible on lock screen)

### 4.4 Frontend: Permission & Subscription

- Create `web/src/composables/usePushNotifications.ts`:
  - `requestPermission()` — triggered by explicit user action (button in settings)
  - `subscribe()` — fetch VAPID key, `pushManager.subscribe()`, POST subscription to backend
  - `unsubscribe()` — remove from pushManager + DELETE on backend
  - Feature detection: `'serviceWorker' in navigator && 'PushManager' in window`
  - Persist subscription state in Pinia store

- Settings UI: "Enable push notifications" toggle
  - Shows permission state: granted / denied / default
  - If denied: show instruction to reset in browser settings

### 4.5 Service Worker: Push + Click Handlers

Create custom SW entry (`web/src/sw.ts` referenced via vite-plugin-pwa `srcDir`):

```ts
// push event — show system notification
self.addEventListener('push', (event) => {
  const data = event.data?.json()
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/pwa-192x192.png',
      badge: '/icons/badge-72x72.png',
      tag: data.tag,
      renotify: true,
      data: { url: data.url, conversationId: data.conversationId },
    })
  )
})

// notification click — focus existing tab or open new
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus()
      }
      return clients.openWindow(url)
    })
  )
})
```

### 4.6 Badge API

- On push event in SW: `navigator.setAppBadge(count)` if available
- On message read / app focus: `navigator.clearAppBadge()`
- Feature-detect: `'setAppBadge' in navigator`
- Update badge count from unread counters in chat store

### 4.7 iOS-Specific Push Flow

- Detect iOS standalone mode: `window.matchMedia('(display-mode: standalone)').matches` or `(navigator as any).standalone`
- If user is in regular Safari (not installed to home screen):
  - Show modal with step-by-step "Add to Home Screen" instructions
  - Only after install, offer push permission
- Use feature detection, not user-agent sniffing
- Create `IosInstallGuide.vue` component with visual instructions

**Deliverables:**

Backend:
- `internal/notifications/service.go` — push delivery service
- `internal/notifications/handler.go` — HTTP endpoints
- `internal/notifications/models.go` — types
- SQL migration for `push_subscriptions`
- Config additions for VAPID keys
- Wired into `cmd/server/main.go` and event bus

Frontend:
- `usePushNotifications.ts` composable
- Custom service worker with push/click handlers
- Badge support
- Settings UI for push toggle
- `IosInstallGuide.vue` component

---

## Phase 5: Desktop-Ready Abstraction Layer (Electron + Tauri)

**Goal:** Abstract platform-specific concerns behind interfaces, with concrete adapter skeletons for both Electron and Tauri. The project will plan for **both** runtimes — Electron for maximum ecosystem compatibility, Tauri for lighter-weight native binaries — and choose per deployment target.

### 5.1 Platform Abstraction Interface

```ts
// web/src/platform/types.ts
export type PlatformType = 'pwa' | 'electron' | 'tauri'

export interface AppNotificationOptions {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  conversationId?: string
  silent?: boolean
  onClick?: () => void
}

export interface PlatformAdapter {
  readonly type: PlatformType

  notifications: {
    requestPermission(): Promise<'granted' | 'denied'>
    show(options: AppNotificationOptions): Promise<void>
    setBadge(count: number): Promise<void>
    clearBadge(): Promise<void>
    /** Desktop-only: play custom sound for notification */
    playSound?(soundId: string): void
  }

  system: {
    setTrayTitle?(title: string): void
    setTrayIcon?(icon: string): void
    setTrayTooltip?(tooltip: string): void
    showTrayBalloon?(title: string, body: string): void
    getAutoLaunch?(): Promise<boolean>
    setAutoLaunch?(enabled: boolean): Promise<void>
    /** Tauri-specific: access Rust commands */
    invokeNative?<T>(command: string, args?: Record<string, unknown>): Promise<T>
  }

  window: {
    minimize?(): void
    close?(): void
    focus?(): void
    isVisible?(): boolean
    /** Electron-specific: close to tray instead of quitting */
    setCloseToTray?(enabled: boolean): void
  }

  storage: {
    /** Secure credential storage (Electron: safeStorage, Tauri: keyring plugin) */
    getSecureItem?(key: string): Promise<string | null>
    setSecureItem?(key: string, value: string): Promise<void>
    deleteSecureItem?(key: string): Promise<void>
  }

  lifecycle: {
    /** Called once at app startup */
    init(): Promise<void>
    /** Called on logout / cleanup */
    dispose(): Promise<void>
  }
}
```

### 5.2 PWA Adapter

```ts
// web/src/platform/pwa-adapter.ts
export class PwaAdapter implements PlatformAdapter {
  readonly type = 'pwa'

  notifications = {
    async requestPermission() {
      if (!('Notification' in window)) return 'denied' as const
      const result = await Notification.requestPermission()
      return result === 'granted' ? 'granted' as const : 'denied' as const
    },
    async show(options: AppNotificationOptions) {
      if (Notification.permission !== 'granted') return
      new Notification(options.title, { body: options.body, icon: options.icon, tag: options.tag })
    },
    async setBadge(count: number) {
      if ('setAppBadge' in navigator) await (navigator as any).setAppBadge(count)
    },
    async clearBadge() {
      if ('clearAppBadge' in navigator) await (navigator as any).clearAppBadge()
    },
  }

  system = {}   // No-op: PWA has no tray/autolaunch
  window = {}   // No-op: PWA has no window control
  storage = {}  // No-op: PWA uses localStorage (synchronous token access)

  lifecycle = {
    async init() { /* SW registration handled by vite-plugin-pwa */ },
    async dispose() { /* Cleanup handled by SW */ },
  }
}
```

### 5.3 Electron Adapter (Skeleton)

```ts
// web/src/platform/electron-adapter.ts
// Only loaded when running inside Electron (detected via window.__ELECTRON__)
// Communicates with main process via contextBridge-exposed preload API

export class ElectronAdapter implements PlatformAdapter {
  readonly type = 'electron'

  notifications = {
    async requestPermission() { return 'granted' as const }, // Electron always has permission
    async show(options: AppNotificationOptions) {
      // Use Electron's Notification API via preload bridge
      window.__electron__.showNotification(options)
    },
    async setBadge(count: number) {
      window.__electron__.setBadgeCount(count)
    },
    async clearBadge() {
      window.__electron__.setBadgeCount(0)
    },
    playSound(soundId: string) {
      window.__electron__.playSound(soundId)
    },
  }

  system = {
    setTrayTitle(title: string) { window.__electron__.setTrayTitle(title) },
    setTrayIcon(icon: string) { window.__electron__.setTrayIcon(icon) },
    setTrayTooltip(tooltip: string) { window.__electron__.setTrayTooltip(tooltip) },
    showTrayBalloon(title: string, body: string) {
      window.__electron__.showTrayBalloon(title, body)
    },
    async getAutoLaunch() { return window.__electron__.getAutoLaunch() },
    async setAutoLaunch(enabled: boolean) { window.__electron__.setAutoLaunch(enabled) },
  }

  window = {
    minimize() { window.__electron__.minimize() },
    close() { window.__electron__.close() },
    focus() { window.__electron__.focus() },
    isVisible() { return window.__electron__.isVisible() },
    setCloseToTray(enabled: boolean) { window.__electron__.setCloseToTray(enabled) },
  }

  storage = {
    async getSecureItem(key: string) { return window.__electron__.safeStorageGet(key) },
    async setSecureItem(key: string, value: string) { window.__electron__.safeStorageSet(key, value) },
    async deleteSecureItem(key: string) { window.__electron__.safeStorageDelete(key) },
  }

  lifecycle = {
    async init() { /* Electron main process handles app ready */ },
    async dispose() { /* IPC cleanup */ },
  }
}
```

**Electron security requirements** (documented for future implementation):
- `contextIsolation: true` — mandatory
- `nodeIntegration: false` — mandatory
- `sandbox: true` — mandatory for renderer
- All main-process APIs exposed only via `contextBridge.exposeInMainWorld()`
- CSP header set in `BrowserWindow.webPreferences`
- No `remote` module usage
- Protocol handler registration for `msgnr://` deep links

### 5.4 Tauri Adapter (Skeleton)

```ts
// web/src/platform/tauri-adapter.ts
// Only loaded when running inside Tauri (detected via window.__TAURI__)
// Communicates with Rust backend via @tauri-apps/api

export class TauriAdapter implements PlatformAdapter {
  readonly type = 'tauri'

  notifications = {
    async requestPermission() {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification')
      if (await isPermissionGranted()) return 'granted' as const
      const result = await requestPermission()
      return result === 'granted' ? 'granted' as const : 'denied' as const
    },
    async show(options: AppNotificationOptions) {
      const { sendNotification } = await import('@tauri-apps/plugin-notification')
      sendNotification({ title: options.title, body: options.body, icon: options.icon })
    },
    async setBadge(count: number) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_badge_count', { count })
    },
    async clearBadge() {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_badge_count', { count: 0 })
    },
    playSound(soundId: string) {
      // Tauri: play via Rust audio command
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('play_sound', { soundId }))
    },
  }

  system = {
    setTrayTitle(title: string) {
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_tray_title', { title }))
    },
    setTrayIcon(icon: string) {
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_tray_icon', { icon }))
    },
    setTrayTooltip(tooltip: string) {
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_tray_tooltip', { tooltip }))
    },
    async getAutoLaunch() {
      const { isEnabled } = await import('@tauri-apps/plugin-autostart')
      return isEnabled()
    },
    async setAutoLaunch(enabled: boolean) {
      const plugin = await import('@tauri-apps/plugin-autostart')
      enabled ? await plugin.enable() : await plugin.disable()
    },
    async invokeNative<T>(command: string, args?: Record<string, unknown>) {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<T>(command, args)
    },
  }

  window = {
    async minimize() {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      getCurrentWindow().minimize()
    },
    async close() {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      getCurrentWindow().close()
    },
    async focus() {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      getCurrentWindow().setFocus()
    },
    isVisible() { return true }, // Tauri: synchronous check not available, default true
  }

  storage = {
    async getSecureItem(key: string) {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<string | null>('keyring_get', { key })
    },
    async setSecureItem(key: string, value: string) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('keyring_set', { key, value })
    },
    async deleteSecureItem(key: string) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('keyring_delete', { key })
    },
  }

  lifecycle = {
    async init() { /* Tauri Rust side handles app setup */ },
    async dispose() { /* Cleanup Tauri event listeners */ },
  }
}
```

**Tauri-specific considerations** (documented for future implementation):
- Tauri v2 plugin system for notifications, autostart, keyring
- Rust commands for custom native features (sound, badge on macOS dock)
- CSP configured in `tauri.conf.json`
- `msgnr://` protocol handler via Tauri deep-link plugin
- Smaller binary size vs Electron (~10MB vs ~150MB)
- No Node.js runtime — all native code is Rust

### 5.5 Platform Provider

```ts
// web/src/platform/index.ts
import { PwaAdapter } from './pwa-adapter'
import type { PlatformAdapter } from './types'

let _adapter: PlatformAdapter | null = null

export async function initPlatform(): Promise<PlatformAdapter> {
  if (_adapter) return _adapter

  if ((window as any).__TAURI__) {
    const { TauriAdapter } = await import('./tauri-adapter')
    _adapter = new TauriAdapter()
  } else if ((window as any).__ELECTRON__) {
    const { ElectronAdapter } = await import('./electron-adapter')
    _adapter = new ElectronAdapter()
  } else {
    _adapter = new PwaAdapter()
  }

  await _adapter.lifecycle.init()
  return _adapter
}

export function usePlatform(): PlatformAdapter {
  if (!_adapter) throw new Error('Platform not initialized. Call initPlatform() first.')
  return _adapter
}
```

**Key design principle:** Desktop adapters are lazy-imported so the PWA build never bundles Electron/Tauri code. The detection relies on globals set by the respective runtimes — no user-agent sniffing.

### 5.6 Integration

- Call `initPlatform()` in `main.ts` before creating the Vue app
- Replace direct `Notification` API calls with `usePlatform().notifications`
- Replace badge calls with abstraction
- Wire notification level (Phase 3A) through the adapter: `usePlatform().notifications.show()` is only called when the notification level permits it
- Document the `window.__ELECTRON__` and `window.__TAURI__` contracts for the respective preload/IPC bridge implementations

### 5.7 Dual-Build Strategy

The Vue app source is shared across all three targets. Build differences:

| Aspect | PWA | Electron | Tauri |
|---|---|---|---|
| Build command | `vite build` | `electron-builder` wrapping `vite build` | `tauri build` wrapping `vite build` |
| Runtime detection | Default | `window.__ELECTRON__` | `window.__TAURI__` |
| Notification delivery | Web Push API | Electron `Notification` | Tauri notification plugin |
| System tray | N/A | Electron `Tray` | Tauri tray plugin |
| Secure storage | N/A (localStorage) | `safeStorage` | OS keyring via plugin |
| Auto-update | SW prompt-to-reload | `electron-updater` | Tauri updater plugin |
| Protocol handler | N/A | `app.setAsDefaultProtocolClient` | Deep-link plugin |
| Binary size | N/A (web) | ~150MB | ~10MB |

The `PlatformAdapter` interface ensures that feature code (notification level checks, badge updates, tray counters) is written once and works across all three targets.

**Deliverables:**
- `web/src/platform/types.ts` — interface definitions with full typing
- `web/src/platform/pwa-adapter.ts` — PWA implementation
- `web/src/platform/electron-adapter.ts` — Electron adapter skeleton (contextBridge-based)
- `web/src/platform/tauri-adapter.ts` — Tauri adapter skeleton (plugin-based)
- `web/src/platform/index.ts` — factory + provider with lazy import
- All notification/badge code routed through platform adapter
- Security and build documentation for both desktop targets

---

## Phase 6: Resilience & Polish

**Goal:** Handle edge cases, sleep/wake, multi-tab, production robustness.

### 6.1 Sleep/Wake Recovery

- Listen to `document.visibilitychange`
- When document becomes visible after being hidden:
  - Check WS state; if disconnected, trigger immediate reconnect
  - Sync IndexedDB cache with server (SyncSince from last watermark)
  - Refresh push subscription if needed
- Existing `useSessionOrchestrator` already handles reconnect; enhance with visibility-aware trigger

### 6.2 Multi-Tab Coordination

- Use `BroadcastChannel` API:
  - Only one tab maintains the active WS connection (leader election)
  - Push notification clicks focus the correct tab
  - Badge count synchronized across tabs
  - Logout propagated to all tabs

### 6.3 Cache Cleanup

- On logout: `msgnrDb.delete()` — wipe all IndexedDB data
- On user switch: full cache wipe + re-bootstrap
- Periodic trim: messages older than 30 days in conversations not opened in 7 days

### 6.4 Sound Notifications (Best-Effort)

Two modes:
- **Guaranteed:** System notification via Push API (OS handles sound)
- **Best effort:** Custom sound when document is visible and user has interacted
- Do NOT attempt custom audio from service worker
- Respect `silent` flag in notification options

### 6.5 Testing Matrix

| Platform | Install | Push | Badge | Offline |
|---|---|---|---|---|
| Chrome desktop | Yes | Yes | Yes | Yes |
| Edge desktop | Yes | Yes | Yes | Yes |
| Safari desktop | Yes | Yes | Partial | Yes |
| Android Chrome | Yes | Yes | Yes | Yes |
| iOS installed (Home Screen) | Yes | Yes* | No | Yes |
| iOS Safari tab | No | No | No | Yes |

*iOS push requires app installed to Home Screen.

---

## Dependency Summary

### New npm packages

| Package | Purpose | Phase |
|---|---|---|
| `vite-plugin-pwa` (devDep) | SW generation, manifest, workbox | 1 |
| `dexie` | IndexedDB wrapper | 3 |

### New Go packages

| Package | Purpose | Phase |
|---|---|---|
| `github.com/SherClockHolmes/webpush-go` | Web Push protocol | 4 |

### New environment variables

| Variable | Example | Phase |
|---|---|---|
| `VAPID_PUBLIC_KEY` | `BEl62i...` (base64url) | 4 |
| `VAPID_PRIVATE_KEY` | `Xyf5a...` (base64url) | 4 |
| `VAPID_SUBJECT` | `mailto:admin@msgnr.app` | 4 |

### Database changes

| Change | Phase |
|---|---|
| `channel_members`: drop `is_muted`, add `notification_level SMALLINT` | 3A |
| New table `push_subscriptions` | 4 |

---

## File Change Map

### Phase 1 — new files
- `web/public/icons/*` — full icon set
- `web/src/composables/usePwaUpdate.ts`
- `web/src/components/PwaUpdateBanner.vue`

### Phase 1 — modified files
- `web/vite.config.ts` — add VitePWA plugin
- `web/index.html` — meta tags, apple touch icon
- `web/package.json` — add vite-plugin-pwa

### Phase 2 — modified files
- `web/vite.config.ts` — runtime caching rules, navigation preload

### Phase 3A — modified files (backend)
- `migrations/schema.sql` — alter `channel_members` (drop `is_muted`, add `notification_level`)
- `api/proto/packets.proto` — `NotificationLevel` enum, field 6 change, new command/response/event
- `internal/repo/queries/channel_members.sql` — new `SetNotificationLevel` query
- `internal/repo/queries/bootstrap.sql` — return `notification_level`
- `internal/chat/service.go` — `SetNotificationLevel` method
- `internal/ws/server.go` — new WS command handler
- `internal/bootstrap/service.go` — map `notification_level`

### Phase 3A — modified files (frontend)
- `web/src/stores/chat.ts` — notification level field, action, event handler
- `web/src/components/AppSidebar.vue` — mute indicator
- `web/src/components/SidebarItem.vue` — suppress badge when muted

### Phase 3A — new files (frontend)
- `web/src/components/NotificationLevelSelector.vue`

### Phase 3B — modified files
- `web/src/stores/chat.ts` — `Message.sendStatus`, retry/discard actions, timeout detection
- `web/src/components/MessageBubble.vue` — visual state overhaul
- `web/src/components/ChatArea.vue` — use `sendStatus` instead of `pending`
- `web/src/components/ThreadPanel.vue` — thread reply send status
- `web/src/composables/useOfflineQueue.ts` — IndexedDB-backed queue (depends on Phase 3)

### Phase 3 — new files
- `web/src/services/db/msgnrDb.ts`
- `web/src/services/db/cache.ts`

### Phase 3 — modified files
- `web/src/composables/useSessionOrchestrator.ts` — cache-first startup
- `web/src/composables/useOfflineQueue.ts` — IndexedDB-backed queue
- `web/src/stores/chat.ts` — write-through to IndexedDB
- `web/package.json` — add dexie

### Phase 4 — new files (backend)
- `internal/notifications/service.go`
- `internal/notifications/handler.go`
- `internal/notifications/models.go`
- SQL migration for `push_subscriptions`

### Phase 4 — new files (frontend)
- `web/src/sw.ts` — custom service worker entry
- `web/src/composables/usePushNotifications.ts`
- `web/src/components/PushPermissionModal.vue`
- `web/src/components/IosInstallGuide.vue`

### Phase 4 — modified files
- `internal/config/config.go` — VAPID config fields + defaults
- `cmd/server/main.go` — wire notifications service + handler
- `web/vite.config.ts` — custom SW entry config

### Phase 5 — new files
- `web/src/platform/types.ts`
- `web/src/platform/pwa-adapter.ts`
- `web/src/platform/electron-adapter.ts` (skeleton)
- `web/src/platform/tauri-adapter.ts` (skeleton)
- `web/src/platform/index.ts`

### Phase 6 — modified files
- `web/src/composables/useSessionOrchestrator.ts` — visibility/wake
- `web/src/stores/chat.ts` — BroadcastChannel coordination
- `web/src/stores/auth.ts` — cache cleanup on logout

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| iOS push requires home-screen install | iPhone Safari users won't get push | iOS install guide UX (Phase 4.7) |
| SW caching stale auth responses | Security risk | Never cache auth endpoints; tokens in localStorage only |
| IndexedDB quota exceeded | Data loss | Conservative limits (50 msgs/conv), handle QuotaExceeded |
| Push subscription rotation | Missed notifications | Re-subscribe on SW activation; 410 cleanup on backend |
| Multi-tab WS conflicts | Duplicate messages | BroadcastChannel leader election (Phase 6.2) |
| Large precache bundle | Slow first load | Exclude livekit/emoji chunks from precache |
| Service worker update race | Stale app | Prompt-to-reload strategy, skipWaiting on user confirm |
| Proto field 6 type change (bool→enum) | Wire incompatibility if old clients hit new server | Acceptable: `is_muted` is always `false` today, value `0` maps to `ALL` correctly. Deploy server + client together. |
| Notification level adds N+1 queries to push delivery | Performance | Batch-fetch notification levels for all target users in a single query per event |
| Failed message UI confuses users | Support burden | Clear error messages, prominent retry button, auto-retry on reconnect for queued messages |
| Dual desktop runtime maintenance (Electron + Tauri) | Double the platform-specific code | Thin adapter layer minimizes per-platform code; shared Vue/Pinia/WS layer is >95% of codebase |
| Tauri v2 plugin ecosystem less mature than Electron | Missing features | Electron as primary desktop target initially; Tauri for lightweight deployments where gaps are acceptable |

---

## Estimated Effort

| Phase | Effort | Dependencies |
|---|---|---|
| Phase 1: Installability | 1-2 days | Icon generation |
| Phase 2: Caching Strategy | 1 day | Phase 1 |
| Phase 3: IndexedDB | 2-3 days | Phase 1 |
| Phase 3A: Mute & Notification Levels | 3-4 days | Proto regen, backend + frontend |
| Phase 3B: Pending Message UX | 2-3 days | Phase 3 (for IndexedDB queue) |
| Phase 4: Push Notifications | 3-4 days | Phase 1 + Phase 3A (notification levels) + backend |
| Phase 5: Platform Abstraction | 2-3 days | Phase 4 (Electron + Tauri skeletons add ~1d) |
| Phase 6: Resilience & Polish | 2-3 days | All above |
| **Total** | **15-22 days** | |

Parallelism notes:
- Phases 2, 3, and 3B frontend work can run in parallel with Phase 3A backend work
- Phase 5 adapter skeletons can start once Phase 4 frontend is complete
- Phase 3A is a hard prerequisite for Phase 4 (push must respect notification levels)
