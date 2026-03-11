import axios from 'axios'
import { getAccessToken } from '@/services/storage/tokenStorage'

/**
 * Returns an Axios instance pre-configured with a Bearer token interceptor.
 * Each service module calls this once at module load time.
 */
export function createAuthenticatedClient() {
  const http = axios.create({ baseURL: '/' })
  http.interceptors.request.use((config) => {
    const token = getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })
  return http
}
