import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TransportDropHandler = (() => void) | null

const mockState = vi.hoisted(() => ({
  transportDropHandler: null as TransportDropHandler,
}))

const mockAuthStore = vi.hoisted(() => ({
  accessToken: 'token-initial',
  refresh: vi.fn<() => Promise<string>>(),
  login: vi.fn<() => Promise<void>>(),
  logout: vi.fn<() => Promise<void>>(),
  setSessionRole: vi.fn<(role: string | null) => void>(),
  loadPersistedRefreshToken: vi.fn<() => string | null>(),
}))

const mockWsStore = vi.hoisted(() => ({
  state: 'DISCONNECTED' as
    | 'DISCONNECTED'
    | 'CONNECTING'
    | 'WS_CONNECTED'
    | 'HELLO_SENT'
    | 'HELLO_COMPLETE'
    | 'AUTH_SENT'
    | 'AUTH_COMPLETE'
    | 'BOOTSTRAPPING'
    | 'LIVE_SYNCED'
    | 'RECOVERING_GAP'
    | 'STALE_REBOOTSTRAP',
  serverHello: null as null | { case: 'serverHello'; value: Record<string, never> },
  authResult: null as null | { userRole: string },
  lastError: null as string | null,
  lastErrorKind: null as 'UNAUTHENTICATED' | 'FORBIDDEN' | 'BAD_REQUEST' | 'PROTOCOL' | 'TRANSPORT' | null,
  lastCloseCode: null as number | null,
  connect: vi.fn<(url: string) => void>(),
  disconnect: vi.fn<(reason: 'logout' | 'transport') => void>(),
  setPendingAuthToken: vi.fn<(token: string) => void>(),
  onAuthFail: vi.fn<(cb: (kind: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'BAD_REQUEST' | 'PROTOCOL' | 'TRANSPORT') => void) => void>(),
  onTransportDrop: vi.fn<(cb: () => void) => void>(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => mockAuthStore,
}))

vi.mock('@/stores/ws', () => ({
  useWsStore: () => mockWsStore,
}))

describe('useSessionOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()

    mockState.transportDropHandler = null
    mockAuthStore.accessToken = 'token-initial'
    mockAuthStore.refresh.mockResolvedValue('token-refreshed')
    mockAuthStore.login.mockResolvedValue()
    mockAuthStore.logout.mockResolvedValue()
    mockAuthStore.loadPersistedRefreshToken.mockReturnValue('refresh-token')

    mockWsStore.state = 'DISCONNECTED'
    mockWsStore.serverHello = null
    mockWsStore.authResult = null
    mockWsStore.lastError = null
    mockWsStore.lastErrorKind = null
    mockWsStore.lastCloseCode = null
    mockWsStore.onTransportDrop.mockImplementation((cb: () => void) => {
      mockState.transportDropHandler = cb
    })
    mockWsStore.onAuthFail.mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes once on auth-stage close 1006 and clears reconnect state on recovery', async () => {
    let connectCall = 0
    mockWsStore.connect.mockImplementation(() => {
      connectCall += 1
      mockWsStore.lastErrorKind = null
      mockWsStore.lastCloseCode = null
      mockWsStore.serverHello = null
      mockWsStore.authResult = null

      if (connectCall === 1) {
        // Initial foreground connect succeeds.
        mockWsStore.state = 'LIVE_SYNCED'
        mockWsStore.authResult = { userRole: 'member' }
        return
      }

      if (connectCall === 2) {
        // Reconnect attempt fails at auth stage: hello happened, auth never completed.
        mockWsStore.state = 'DISCONNECTED'
        mockWsStore.serverHello = { case: 'serverHello', value: {} }
        mockWsStore.lastCloseCode = 1006
        return
      }

      // Refresh retry succeeds.
      mockWsStore.state = 'LIVE_SYNCED'
      mockWsStore.authResult = { userRole: 'member' }
    })

    const { useSessionOrchestrator } = await import('@/composables/useSessionOrchestrator')
    const orchestrator = useSessionOrchestrator()

    const firstConnect = orchestrator.connectAndAuthenticate('token-initial')
    await vi.advanceTimersByTimeAsync(100)
    await expect(firstConnect).resolves.toBe(true)
    expect(mockState.transportDropHandler).not.toBeNull()

    // Simulate transport drop after the initial successful session.
    mockWsStore.state = 'DISCONNECTED'
    mockState.transportDropHandler?.()
    expect(orchestrator.isReconnecting.value).toBe(true)

    await vi.advanceTimersByTimeAsync(5_500)

    expect(mockAuthStore.refresh).toHaveBeenCalledTimes(1)
    expect(mockWsStore.connect).toHaveBeenCalledTimes(3)
    expect(orchestrator.isReconnecting.value).toBe(false)
    expect(orchestrator.reconnectAttempt.value).toBe(0)
  })
})
