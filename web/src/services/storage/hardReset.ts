import { getBackendBaseUrl, setBackendBaseUrl } from '@/services/runtime/backendEndpoint'
import { clearAllData, deleteDatabase } from '@/services/db/cache'
import { storage } from '@/services/storage/storageAdapter'
import { clearStoredTokensAsync } from '@/services/storage/tokenStorage'

async function clearCacheStorage(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const names = await caches.keys()
    await Promise.all(names.map((name) => caches.delete(name)))
  } catch {
    // Best effort cleanup.
  }
}

function clearSessionStorage(): void {
  try {
    globalThis.sessionStorage?.clear()
  } catch {
    // Best effort cleanup.
  }
}

/**
 * Clears all persisted client data for the current origin.
 * The desktop backend URL is preserved and restored after the wipe.
 */
export async function clearAllPersistedClientDataPreservingBackendUrl(): Promise<void> {
  const preservedBackendUrl = getBackendBaseUrl()

  await clearStoredTokensAsync()

  try {
    storage.clear()
  } catch {
    // Best effort cleanup.
  }

  clearSessionStorage()

  await Promise.allSettled([
    clearAllData(),
    deleteDatabase(),
    clearCacheStorage(),
  ])

  if (preservedBackendUrl) {
    try {
      setBackendBaseUrl(preservedBackendUrl)
    } catch {
      // Ignore invalid persisted value.
    }
  }
}
