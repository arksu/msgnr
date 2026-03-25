import axios, { AxiosError } from 'axios'
import { resolveApiBaseUrl } from '@/services/runtime/backendEndpoint'
import {
  clearAccessToken,
  clearRefreshToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from '@/services/storage/tokenStorage'

export interface RefreshedSessionTokens {
  accessToken: string
  refreshToken: string
}

function hasRejectedRefreshStatus(error: unknown): boolean {
  if (error instanceof AxiosError) {
    return error.response?.status === 401 || error.response?.status === 403
  }
  if (
    typeof error === 'object'
    && error !== null
    && 'status' in error
    && typeof (error as { status?: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status
    return status === 401 || status === 403
  }
  return false
}

async function requestRefresh(refreshToken: string): Promise<RefreshedSessionTokens | null> {
  const { data } = await axios.post<{
    access_token?: string
    refresh_token?: string
  }>('/api/auth/refresh', {
    refresh_token: refreshToken,
  }, {
    baseURL: resolveApiBaseUrl(),
  })

  if (!data?.access_token || !data?.refresh_token) {
    return null
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  }
}

export async function refreshSharedSessionTokens(
  request: ((refreshToken: string) => Promise<RefreshedSessionTokens | null>) = requestRefresh,
): Promise<RefreshedSessionTokens | null> {
  const attempted = new Set<string>()
  let refreshToken = getRefreshToken()

  while (refreshToken && !attempted.has(refreshToken)) {
    attempted.add(refreshToken)

    try {
      const nextTokens = await request(refreshToken)
      if (!nextTokens?.accessToken || !nextTokens.refreshToken) {
        break
      }

      setAccessToken(nextTokens.accessToken)
      setRefreshToken(nextTokens.refreshToken)
      return nextTokens
    } catch (error) {
      if (!hasRejectedRefreshStatus(error)) {
        throw error
      }

      const latestRefreshToken = getRefreshToken()
      if (!latestRefreshToken || latestRefreshToken === refreshToken) {
        clearAccessToken()
        clearRefreshToken()
        return null
      }

      refreshToken = latestRefreshToken
    }
  }

  clearAccessToken()
  clearRefreshToken()
  return null
}
