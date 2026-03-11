import { storage } from '@/services/storage/storageAdapter'

const REFRESH_KEY = 'msgnr.refresh_token'
const ACCESS_KEY = 'msgnr.access_token'

export function getRefreshToken(): string | null {
  return storage.getItem(REFRESH_KEY)
}

export function setRefreshToken(token: string): void {
  storage.setItem(REFRESH_KEY, token)
}

export function clearRefreshToken(): void {
  storage.removeItem(REFRESH_KEY)
}

export function getAccessToken(): string | null {
  return storage.getItem(ACCESS_KEY)
}

export function setAccessToken(token: string): void {
  storage.setItem(ACCESS_KEY, token)
}

export function clearAccessToken(): void {
  storage.removeItem(ACCESS_KEY)
}
