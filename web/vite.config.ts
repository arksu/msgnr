import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
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
