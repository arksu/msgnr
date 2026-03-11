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
        'favicon.svg',
        'favicon.ico',
        'apple-touch-icon-180x180.png',
        'badge-72x72.png',
      ],
      manifest: {
        name: 'Msgnr',
        short_name: 'Msgnr',
        description: 'Msgnr messenger',
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/, /^\/health/, /^\/ready/],
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
