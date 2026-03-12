/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare let self: ServiceWorkerGlobalScope

// ---------------------------------------------------------------------------
// Workbox precache + cleanup
// ---------------------------------------------------------------------------

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// ---------------------------------------------------------------------------
// Navigation fallback — serve cached index.html for all navigations except
// API, WS, and infrastructure endpoints.
// ---------------------------------------------------------------------------

const navigationHandler = new NetworkFirst({ cacheName: 'navigations' })
registerRoute(
  new NavigationRoute(navigationHandler, {
    denylist: [/^\/api\//, /^\/ws/, /^\/health/, /^\/ready/],
  }),
)

// ---------------------------------------------------------------------------
// Runtime caching (migrated from vite.config.ts workbox.runtimeCaching)
// ---------------------------------------------------------------------------

// LiveKit WebRTC SDK — cache on first call join, serve stale while revalidating
registerRoute(
  ({ url }) => /\/assets\/vendor-livekit-.*\.js$/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'vendor-livekit',
    plugins: [new ExpirationPlugin({ maxEntries: 2, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
)

// Emoji picker data + styles — cache on first emoji click
registerRoute(
  ({ url }) => /\/assets\/vendor-emoji-.*\.(js|css)$/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'vendor-emoji',
    plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
)

// RNNoise WASM files — large, never change per version, cache aggressively
registerRoute(
  ({ url }) => /\/rnnoise-.*\.js$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'rnnoise-wasm',
    plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 90 * 24 * 60 * 60 })],
  }),
)

// Avatar images — public endpoint, immutable once uploaded, cache aggressively
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/public/avatars/'),
  new CacheFirst({
    cacheName: 'avatars',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

// ---------------------------------------------------------------------------
// Push notification handler
// ---------------------------------------------------------------------------

interface PushPayload {
  type: string
  title: string
  body: string
  conversationId?: string
  messageId?: string
  tag: string
  url: string
}

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return

  let data: PushPayload
  try {
    data = event.data.json() as PushPayload
  } catch {
    // Malformed payload — ignore
    return
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192x192.png',
      badge: '/badge-72x72.png',
      tag: data.tag,
      data: {
        url: data.url || '/',
        conversationId: data.conversationId,
      },
    }),
  )
})

// ---------------------------------------------------------------------------
// Notification click — focus existing window or open new one
// ---------------------------------------------------------------------------

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  const targetUrl: string = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Prefer an existing window at our origin — focus it and navigate.
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus()
          if ('navigate' in client) {
            ;(client as WindowClient).navigate(targetUrl)
          }
          return
        }
      }
      // No existing window — open a new one.
      return self.clients.openWindow(targetUrl)
    }),
  )
})

// ---------------------------------------------------------------------------
// Message handler for prompt-to-reload (vite-plugin-pwa registerType: 'prompt')
// ---------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
