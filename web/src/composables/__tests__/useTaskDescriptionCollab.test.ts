import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskDescriptionCollabMessageKind } from '@/shared/proto/packets_pb'
import { useTaskDescriptionCollab } from '@/composables/useTaskDescriptionCollab'

const mockState = vi.hoisted(() => ({
  onSubscribeResponse: null as ((payload: { taskId: string; persistedMarkdown: string }) => void) | null,
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
  onTaskDescriptionCollabSubscribeResponse: vi.fn<(cb: (payload: { taskId: string; persistedMarkdown: string }) => void) => void>((cb) => {
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
  const Host = defineComponent({
    setup() {
      const taskId = ref('task-1')
      const user = ref({
        id: 'user-1',
        name: 'User One',
        color: '#60a5fa',
      })
      useTaskDescriptionCollab({ taskId, user })
      return {}
    },
    template: '<div />',
  })

  return mount(Host)
}

describe('useTaskDescriptionCollab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.onSubscribeResponse = null
    mockState.onMessage = null
    mockWsStore.state = 'LIVE_SYNCED'
  })

  it('broadcasts initial awareness state after subscribing', async () => {
    const wrapper = mountHost()
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
