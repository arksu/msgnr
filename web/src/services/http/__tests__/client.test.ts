import axios, { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAccessToken,
  clearRefreshToken,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from '@/services/storage/tokenStorage'

describe('createAuthenticatedClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    clearAccessToken()
    clearRefreshToken()
  })

  it('refreshes access token on 401 and retries request once', async () => {
    setAccessToken('expired-token')
    setRefreshToken('refresh-token-1')

    const { createAuthenticatedClient } = await import('@/services/http/client')
    const http = createAuthenticatedClient()

    const authHeaders: string[] = []
    let attempt = 0
    http.defaults.adapter = vi.fn(async (config) => {
      attempt += 1
      authHeaders.push(String((config.headers as Record<string, unknown> | undefined)?.Authorization ?? ''))
      if (attempt === 1) {
        throw new AxiosError(
          'Unauthorized',
          'ERR_BAD_REQUEST',
          config,
          undefined,
          {
            data: { error: 'unauthorized' },
            status: 401,
            statusText: 'Unauthorized',
            headers: {},
            config,
          },
        )
      }
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    })

    vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        access_token: 'fresh-token',
        refresh_token: 'refresh-token-2',
        expires_in_sec: 3600,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as any,
    })

    const response = await http.get('/api/messages')

    expect(response.data).toEqual({ ok: true })
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(authHeaders).toEqual(['Bearer expired-token', 'Bearer fresh-token'])
    expect(getAccessToken()).toBe('fresh-token')
    expect(getRefreshToken()).toBe('refresh-token-2')
  })
})
