import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [
        AntDesignVueResolver({ importStyle: false }),
      ],
    }),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon-180x180.png',
        'badge-72x72.png',
        'pwa-64x64.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'maskable-icon-512x512.png',
      ],
      manifest: {
        name: 'Msgnr',
        short_name: 'Msgnr',
        description: 'Team messenger',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#1a1d21',
        background_color: '#1a1d21',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache: app shell JS/CSS/HTML + SVG + fonts.
        // PNG/ICO icons handled via includeAssets above.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Exclude heavy lazy-loaded chunks from precache — they use runtime cache instead.
        globIgnores: [
          '**/rnnoise-*.js',        // ~3.8MB WASM, only needed during voice calls
          '**/vendor-livekit-*.js',  // ~439KB, lazy-loaded on call join
          '**/vendor-emoji-*.js',    // ~885KB, lazy-loaded on first emoji click
          '**/vendor-emoji-*.css',   // emoji picker styles
        ],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/, /^\/health/, /^\/ready/],
        // Speed up navigation on Chrome/Edge — network request starts in parallel with SW boot.
        navigationPreload: true,
        runtimeCaching: [
          // LiveKit WebRTC SDK — cache on first call join, serve stale while revalidating
          {
            urlPattern: /\/assets\/vendor-livekit-.*\.js$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'vendor-livekit',
              expiration: { maxEntries: 2, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          // Emoji picker data + styles — cache on first emoji click
          {
            urlPattern: /\/assets\/vendor-emoji-.*\.(js|css)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'vendor-emoji',
              expiration: { maxEntries: 4, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          // RNNoise WASM files — large, never change per version, cache aggressively
          {
            urlPattern: /\/rnnoise-.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rnnoise-wasm',
              expiration: { maxEntries: 4, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
          // Avatar images — public endpoint, immutable once uploaded, cache aggressively
          {
            urlPattern: /\/api\/public\/avatars\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'avatars',
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // LiveKit — large WebRTC library, keep in its own cached chunk
          if (id.includes('livekit-client')) return 'vendor-livekit'

          // Emoji picker data + source — lazy-loaded on first emoji click
          if (id.includes('emoji-mart-vue-fast') || id.includes('@emoji-mart')) return 'vendor-emoji'

          // Protobuf runtime — separate from Vue core so each can be cached independently
          if (id.includes('@bufbuild/protobuf')) return 'vendor-proto'

          // Vue core + router + pinia + axios — shared bootstrap
          if (
            id.includes('/node_modules/vue/') ||
            id.includes('/node_modules/@vue/') ||
            id.includes('/node_modules/vue-router/') ||
            id.includes('/node_modules/pinia/') ||
            id.includes('/node_modules/axios/')
          ) return 'vendor-core'
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
      '/api': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
      '/ready': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
