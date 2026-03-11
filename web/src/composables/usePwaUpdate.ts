import { useRegisterSW } from 'virtual:pwa-register/vue'

/**
 * Composable wrapping service worker registration and update lifecycle.
 *
 * - `needRefresh`       — true when a new SW is installed and waiting to activate
 * - `offlineReady`      — true when the SW has precached the app shell
 * - `updateServiceWorker()` — skip waiting + reload the page with the new version
 * - `close()`           — dismiss the current prompt without updating
 */
export function usePwaUpdate() {
  const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      if (import.meta.env.DEV) {
        console.debug('[PWA] Service worker registered:', swUrl)
      }

      // Periodically check for updates (every 60 minutes)
      if (registration) {
        setInterval(() => {
          registration.update()
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.error('[PWA] Service worker registration failed:', error)
    },
  })

  function close() {
    needRefresh.value = false
    offlineReady.value = false
  }

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker,
    close,
  }
}
