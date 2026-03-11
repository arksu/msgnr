import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  apiGetProfile,
  apiLogin,
  apiRefresh,
  apiLogout,
  apiUpdateProfile,
  apiChangePassword,
  apiUploadAvatar,
  apiRemoveAvatar,
  AuthApiError,
  type UserDto,
  type UpdateProfileRequest,
} from '@/services/http/authApi'
import {
  getRefreshToken,
  getAccessToken,
  setRefreshToken,
  clearRefreshToken,
  setAccessToken,
  clearAccessToken,
} from '@/services/storage/tokenStorage'
import { clearLastAppliedEventSeq } from '@/services/storage/syncStateStorage'
import { clearClientInstanceId } from '@/services/storage/clientInstanceStorage'
import { clearManualPresencePreference } from '@/services/storage/manualPresenceStorage'
import { clearAllLastOpenedConversations } from '@/services/storage/lastConversationStorage'
import { clearStoredThreadSummaries } from '@/services/storage/threadSummaryStorage'
import { clearLastOpenedTaskId } from '@/services/storage/lastTaskRouteStorage'
import { cacheUserProfile, loadCachedUserProfile, clearAllData as clearIndexedDb } from '@/services/db/cache'

export type AuthState =
  | 'ANON'
  | 'LOGGING_IN'
  | 'AUTHENTICATED'
  | 'REFRESHING'
  | 'LOGGING_OUT'
  | 'AUTH_ERROR'

export interface AuthUser {
  id: string
  email: string
  displayName: string
  avatarUrl?: string
  role: string
}

const AUTH_USER_STORAGE_KEY = 'auth.user'

/**
 * Decode the payload of a JWT without verifying its signature.
 * Safe to use on the client side — the server already validated the token.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return {}
    // Base64url → base64 → decode
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

function isServerUnavailableError(error: unknown): error is AuthApiError {
  return error instanceof AuthApiError && (error.status === 0 || error.status >= 500)
}

function toUser(dto: UserDto): AuthUser {
  return {
    id: dto.id,
    email: dto.email,
    displayName: dto.display_name,
    avatarUrl: dto.avatar_url ?? '',
    role: dto.role,
  }
}

function saveUser(user: AuthUser | null) {
  try {
    if (!user) {
      globalThis.localStorage?.removeItem(AUTH_USER_STORAGE_KEY)
      return
    }
    globalThis.localStorage?.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user))
    // Write-through to IndexedDB (fire-and-forget)
    void cacheUserProfile({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
    })
  } catch {
    // best-effort persistence
  }
}

function loadUser(): AuthUser | null {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_USER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthUser>
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.id || !parsed.email) return null
    return {
      id: String(parsed.id),
      email: String(parsed.email),
      displayName: String(parsed.displayName ?? ''),
      avatarUrl: String(parsed.avatarUrl ?? ''),
      role: String(parsed.role ?? ''),
    }
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const authState = ref<AuthState>('ANON')
  const user = ref<AuthUser | null>(loadUser())
  const accessToken = ref<string | null>(null)
  const lastAuthError = ref<string | null>(null)
  const sessionRole = ref<string | null>(null)
  const effectiveRole = computed(() => user.value?.role ?? sessionRole.value)
  const needChangePassword = ref<boolean>(false)
  let refreshRetryTimer: ReturnType<typeof setTimeout> | null = null

  function loadPersistedRefreshToken(): string | null {
    return getRefreshToken()
  }

  /**
   * If the synchronous localStorage read returned null (e.g. storage cleared
   * by the browser), attempt to recover the user profile from IndexedDB.
   * Called during cache-first startup before the auth token is refreshed.
   */
  async function hydrateUserFromCache(): Promise<void> {
    if (user.value) return // Already loaded from localStorage
    try {
      const cached = await loadCachedUserProfile()
      if (!cached) return
      user.value = {
        id: cached.id,
        email: cached.email,
        displayName: cached.displayName,
        avatarUrl: cached.avatarUrl,
        role: cached.role ?? '',
      }
    } catch {
      // Non-fatal — auth.refresh() will set the user when it succeeds.
    }
  }

  async function login(email: string, password: string): Promise<void> {
    authState.value = 'LOGGING_IN'
    lastAuthError.value = null
    try {
      const res = await apiLogin(email, password)
      accessToken.value = res.access_token
      setRefreshToken(res.refresh_token)
      setAccessToken(res.access_token)
      user.value = toUser(res.user)
      saveUser(user.value)
      sessionRole.value = res.user.role
      // Read from both the response body and the JWT so the flag survives page refreshes.
      const loginClaims = decodeJwtPayload(res.access_token)
      needChangePassword.value =
        (loginClaims.need_change_password === true) || (res.user.need_change_password ?? false)
      authState.value = 'AUTHENTICATED'
    } catch (e) {
      lastAuthError.value = e instanceof AuthApiError ? e.message : 'Login failed'
      authState.value = 'AUTH_ERROR'
      throw e
    }
  }

  async function refresh(): Promise<string> {
    const stored = getRefreshToken()
    if (!stored) {
      clearSession()
      throw new AuthApiError('No refresh token', 401)
    }
    authState.value = 'REFRESHING'
    lastAuthError.value = null
    try {
      const res = await apiRefresh(stored)
      accessToken.value = res.access_token
      setRefreshToken(res.refresh_token)
      setAccessToken(res.access_token)
      // Restore need_change_password from the new JWT payload so a page refresh
      // doesn't bypass the mandatory password change dialog.
      const claims = decodeJwtPayload(res.access_token)
      needChangePassword.value = claims.need_change_password === true
      authState.value = 'AUTHENTICATED'
      clearRefreshRetryTimer()
      return res.access_token
    } catch (e) {
      if (isServerUnavailableError(e)) {
        const persistedAccessToken = accessToken.value ?? getAccessToken()
        if (persistedAccessToken) {
          accessToken.value = persistedAccessToken
          setAccessToken(persistedAccessToken)
          // Also restore from any persisted token when the server is temporarily unavailable.
          const fallbackClaims = decodeJwtPayload(persistedAccessToken)
          needChangePassword.value = fallbackClaims.need_change_password === true
          authState.value = 'AUTHENTICATED'
          lastAuthError.value = 'Server is unavailable'
          scheduleRefreshRetry()
          throw e
        }
      }

      lastAuthError.value = e instanceof AuthApiError ? e.message : 'Refresh failed'
      clearSession()
      throw e
    }
  }

  async function logout(): Promise<void> {
    authState.value = 'LOGGING_OUT'
    const stored = getRefreshToken()
    if (stored) {
      try {
        await apiLogout(stored)
      } catch {
        // best-effort; always clear locally
      }
    }
    clearSession()
  }

  async function ensureUserLoaded(): Promise<AuthUser | null> {
    if (user.value) return user.value
    const token = accessToken.value ?? getAccessToken()
    if (!token) return null
    const profile = await apiGetProfile()
    user.value = toUser(profile)
    saveUser(user.value)
    return user.value
  }

  async function changePassword(newPassword: string): Promise<void> {
    await apiChangePassword(newPassword)
    needChangePassword.value = false
  }

  function assertAuthenticated() {
    const token = accessToken.value ?? getAccessToken()
    if (!token) {
      throw new AuthApiError('Not authenticated', 401)
    }
  }

  async function updateProfile(payload: UpdateProfileRequest): Promise<AuthUser> {
    assertAuthenticated()

    const request: UpdateProfileRequest = {
      display_name: payload.display_name?.trim(),
      email: payload.email?.trim(),
    }

    if (!request.display_name && !request.email) {
      throw new AuthApiError('No profile fields to update', 400)
    }

    const updated = await apiUpdateProfile(request)
    user.value = toUser(updated)
    saveUser(user.value)
    return toUser(updated)
  }

  async function uploadAvatar(file: File): Promise<AuthUser> {
    assertAuthenticated()
    const updated = await apiUploadAvatar(file)
    user.value = toUser(updated)
    saveUser(user.value)
    return toUser(updated)
  }

  async function removeAvatar(): Promise<AuthUser> {
    assertAuthenticated()
    const updated = await apiRemoveAvatar()
    user.value = toUser(updated)
    saveUser(user.value)
    return toUser(updated)
  }

  function clearSession(): void {
    clearRefreshRetryTimer()
    accessToken.value = null
    user.value = null
    saveUser(null)
    sessionRole.value = null
    needChangePassword.value = false
    clearRefreshToken()
    clearAccessToken()
    clearLastAppliedEventSeq()
    clearClientInstanceId()
    clearManualPresencePreference()
    clearAllLastOpenedConversations()
    clearStoredThreadSummaries()
    clearLastOpenedTaskId()
    // Wipe all IndexedDB cached data (fire-and-forget)
    void clearIndexedDb()
    authState.value = 'ANON'
  }

  function setSessionRole(role: string | null) {
    sessionRole.value = role
  }

  function setNeedChangePassword(val: boolean) {
    needChangePassword.value = val
  }

  function clearRefreshRetryTimer() {
    if (refreshRetryTimer) {
      clearTimeout(refreshRetryTimer)
      refreshRetryTimer = null
    }
  }

  function scheduleRefreshRetry() {
    if (refreshRetryTimer) return
    refreshRetryTimer = setTimeout(async () => {
      refreshRetryTimer = null
      if (lastAuthError.value !== 'Server is unavailable') return
      if (!getRefreshToken()) return
      try {
        await refresh()
      } catch (error) {
        if (isServerUnavailableError(error)) return
      }
    }, 5000)
  }

  return {
    authState,
    user,
    accessToken,
    lastAuthError,
    sessionRole,
    effectiveRole,
    needChangePassword,
    loadPersistedRefreshToken,
    hydrateUserFromCache,
    login,
    refresh,
    logout,
    ensureUserLoaded,
    updateProfile,
    uploadAvatar,
    removeAvatar,
    changePassword,
    setSessionRole,
    setNeedChangePassword,
    clearSession,
  }
})
