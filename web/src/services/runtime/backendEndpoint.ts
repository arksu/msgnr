import { isTauriRuntime } from '@/platform/runtime'
import { storage } from '@/services/storage/storageAdapter'

const BACKEND_BASE_URL_KEY = 'msgnr.desktop.backend_base_url'

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

export function normalizeBackendBaseUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return stripTrailingSlashes(parsed.toString())
  } catch {
    return null
  }
}

export function isValidBackendBaseUrl(raw: string): boolean {
  return normalizeBackendBaseUrl(raw) !== null
}

export function getBackendBaseUrl(): string {
  const stored = storage.getItem(BACKEND_BASE_URL_KEY)
  if (!stored) return ''
  return normalizeBackendBaseUrl(stored) ?? ''
}

export function hasBackendBaseUrl(): boolean {
  return Boolean(getBackendBaseUrl())
}

export function setBackendBaseUrl(raw: string): string {
  const normalized = normalizeBackendBaseUrl(raw)
  if (!normalized) {
    throw new Error('Backend URL must be a valid http(s) URL.')
  }
  storage.setItem(BACKEND_BASE_URL_KEY, normalized)
  return normalized
}

export function clearBackendBaseUrl(): void {
  storage.removeItem(BACKEND_BASE_URL_KEY)
}

export function requiresConfiguredBackendUrl(): boolean {
  return isTauriRuntime()
}

export function resolveApiBaseUrl(): string {
  if (!isTauriRuntime()) return '/'
  const configured = getBackendBaseUrl()
  return configured || '/'
}

export function resolveWsUrl(): string {
  if (!isTauriRuntime()) return '/ws'

  const base = getBackendBaseUrl()
  if (!base) return '/ws'

  try {
    const wsUrl = new URL(base)
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    wsUrl.pathname = '/ws'
    wsUrl.search = ''
    wsUrl.hash = ''
    return wsUrl.toString()
  } catch {
    return '/ws'
  }
}
