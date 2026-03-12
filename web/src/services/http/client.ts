import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  clearAccessToken,
  clearRefreshToken,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from '@/services/storage/tokenStorage'
import { resolveApiBaseUrl } from '@/services/runtime/backendEndpoint'

interface RefreshResponse {
  access_token: string
  refresh_token: string
}

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retryAuth?: boolean
}

let refreshInFlight: Promise<string | null> | null = null

function shouldSkipAuthRefresh(url: string | undefined) {
  if (!url) return false
  return (
    url.includes('/api/auth/login') ||
    url.includes('/api/auth/refresh') ||
    url.includes('/api/auth/logout')
  )
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null
  try {
    const { data } = await axios.post<RefreshResponse>('/api/auth/refresh', {
      refresh_token: refreshToken,
    }, {
      baseURL: resolveApiBaseUrl(),
    })
    if (!data?.access_token || !data?.refresh_token) {
      return null
    }
    setAccessToken(data.access_token)
    setRefreshToken(data.refresh_token)
    return data.access_token
  } catch (e) {
    if (e instanceof AxiosError && (e.response?.status === 401 || e.response?.status === 403)) {
      clearAccessToken()
      clearRefreshToken()
      return null
    }
    throw e
  }
}

/**
 * Returns an Axios instance pre-configured with a Bearer token interceptor.
 * Each service module calls this once at module load time.
 */
export function createAuthenticatedClient() {
  const http = axios.create({ baseURL: resolveApiBaseUrl() })
  http.interceptors.request.use((config) => {
    config.baseURL = resolveApiBaseUrl()
    const token = getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  http.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetriableRequestConfig | undefined
      if (!config) throw error
      if (error.response?.status !== 401) throw error
      if (config._retryAuth) throw error
      if (shouldSkipAuthRefresh(config.url)) throw error

      config._retryAuth = true
      try {
        if (!refreshInFlight) {
          refreshInFlight = refreshAccessToken().finally(() => {
            refreshInFlight = null
          })
        }
        const nextToken = await refreshInFlight
        if (!nextToken) {
          clearAccessToken()
          clearRefreshToken()
          throw error
        }
        config.headers = config.headers ?? {}
        config.headers.Authorization = `Bearer ${nextToken}`
        return await http.request(config)
      } catch {
        throw error
      }
    },
  )

  return http
}
