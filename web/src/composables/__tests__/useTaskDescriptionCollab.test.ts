import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskDescriptionCollabMessageKind } from '@/shared/proto/packets_pb'
import { useTaskDescriptionCollab } from '@/composables/useTaskDescriptionCollab'

const mockState = vi.hoisted(() => ({
  onSubscribeResponse: null as ((payload: { taskId: string; persistedMarkdown: string; subscriberCount: number }) => void) | null,
  onMessage: null as ((payload: { taskId: string; kind: TaskDescriptionCollabMessageKind; payload: Uint8Array }) => void) | null,
}))

const mockWsStore = vi.hoisted(() => ({
  state: 'LIVE_SYNCED' as
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
  sendTaskDescriptionCollabSubscribe: vi.fn<(taskId: string) => string>(() => 'req-subscribe'),
  sendTaskDescriptionCollabUnsubscribe: vi.fn<(taskId: string) => string>(() => 'req-unsubscribe'),
  sendTaskDescriptionCollabMessage: vi.fn<(taskId: string, kind: TaskDescriptionCollabMessageKind, payload: Uint8Array) => string>(() => 'req-message'),
  onTaskDescriptionCollabSubscribeResponse: vi.fn<(cb: (payload: { taskId: string; persistedMarkdown: string; subscriberCount: number }) => void) => void>((cb) => {
    mockState.onSubscribeResponse = cb
  }),
  onTaskDescriptionCollabMessage: vi.fn<(cb: (payload: { taskId: string; kind: TaskDescriptionCollabMessageKind; payload: Uint8Array }) => void) => void>((cb) => {
    mockState.onMessage = cb
  }),
}))

vi.mock('@/stores/ws', () => ({
  useWsStore: () => mockWsStore,
}))

function mountHost() {
  let collabState: ReturnType<typeof useTaskDescriptionCollab> | null = null
  const Host = defineComponent({
    setup() {
      const taskId = ref('task-1')
      const user = ref({
        id: 'user-1',
        name: 'User One',
        color: '#60a5fa',
      })
      collabState = useTaskDescriptionCollab({ taskId, user })
      return {}
    },
    template: '<div />',
  })

  return {
    wrapper: mount(Host),
    getCollabState() {
      if (!collabState) throw new Error('collab state is not initialized')
      return collabState
    },
  }
}

describe('useTaskDescriptionCollab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockState.onSubscribeResponse = null
    mockState.onMessage = null
    mockWsStore.state = 'LIVE_SYNCED'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('seeds persisted markdown for the first subscriber and requests peer state', async () => {
    const { wrapper, getCollabState } = mountHost()
    await nextTick()

    mockState.onSubscribeResponse?.({
      taskId: 'task-1',
      persistedMarkdown: 'aabb',
      subscriberCount: 1,
    })
    await vi.advanceTimersByTimeAsync(260)

    expect(getCollabState().serverMarkdown.value).toBe('aabb')
    const syncSends = mockWsStore.sendTaskDescriptionCollabMessage.mock.calls.filter(
      (call) => call[1] === TaskDescriptionCollabMessageKind.SYNC,
    )
    expect(syncSends.length).toBeGreaterThan(0)
    expect((syncSends[0][2] as Uint8Array)[3]).toBe(2)

    wrapper.unmount()
  })

  it('skips persisted seed for non-first subscribers and still requests peer state', async () => {
    const { wrapper, getCollabState } = mountHost()
    await nextTick()

    mockState.onSubscribeResponse?.({
      taskId: 'task-1',
      persistedMarkdown: 'aabb',
      subscriberCount: 2,
    })
    await vi.advanceTimersByTimeAsync(260)

    expect(getCollabState().serverMarkdown.value).toBeNull()
    const syncSends = mockWsStore.sendTaskDescriptionCollabMessage.mock.calls.filter(
      (call) => call[1] === TaskDescriptionCollabMessageKind.SYNC,
    )
    expect(syncSends.length).toBeGreaterThan(0)
    expect((syncSends[0][2] as Uint8Array)[3]).toBe(2)

    wrapper.unmount()
  })

  it('broadcasts initial awareness state after subscribing', async () => {
    const { wrapper } = mountHost()
    await nextTick()

    expect(mockWsStore.sendTaskDescriptionCollabSubscribe).toHaveBeenCalledWith('task-1')
    const awarenessSends = mockWsStore.sendTaskDescriptionCollabMessage.mock.calls.filter(
      (_call) => _call[1] === TaskDescriptionCollabMessageKind.AWARENESS,
    )
    expect(awarenessSends.length).toBeGreaterThan(0)
    expect(awarenessSends[0][0]).toBe('task-1')
    expect((awarenessSends[0][2] as Uint8Array).length).toBeGreaterThan(0)

    wrapper.unmount()
  })
})
