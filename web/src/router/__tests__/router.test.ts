import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import * as tokenStorage from '@/services/storage/tokenStorage'

const orchestratorMocks = vi.hoisted(() => ({
  tryRestoreSession: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('@/composables/useSessionOrchestrator', () => ({
  useSessionOrchestrator: () => ({
    tryRestoreSession: orchestratorMocks.tryRestoreSession,
  }),
}))

describe('router auth guard', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    tokenStorage.clearRefreshToken()
    tokenStorage.clearAccessToken()
    orchestratorMocks.tryRestoreSession.mockReset()

    const { default: router } = await import('@/router')
    await router.push('/login')
  })

  it('redirects unauthenticated user from /tasks to login', async () => {
    const { default: router } = await import('@/router')
    await router.push('/tasks')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('redirects unauthenticated user from /tasks/:taskId to login', async () => {
    const { default: router } = await import('@/router')
    await router.push('/tasks/task-1')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('allows authenticated user to open /tasks and /tasks/:taskId', async () => {
    const { default: router } = await import('@/router')
    const auth = useAuthStore()
    auth.authState = 'AUTHENTICATED'

    await router.push('/tasks')
    expect(router.currentRoute.value.name).toBe('tasks-list')

    await router.push('/tasks/task-1')
    expect(router.currentRoute.value.name).toBe('tasks-card')
    expect(router.currentRoute.value.params.taskId).toBe('task-1')
  })

  it('keeps main route when restore fails but auth store stays authenticated (server unavailable)', async () => {
    tokenStorage.setRefreshToken('refresh-token')
    tokenStorage.setAccessToken('access-token')
    orchestratorMocks.tryRestoreSession.mockImplementation(async () => {
      const auth = useAuthStore()
      auth.accessToken = 'access-token'
      auth.authState = 'AUTHENTICATED'
      auth.lastAuthError = 'Server is unavailable'
      return false
    })

    const { default: router } = await import('@/router')
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('main')
  })
})
