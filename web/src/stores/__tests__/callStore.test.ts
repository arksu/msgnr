import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { NotificationLevel } from '@/shared/proto/packets_pb'
import { useCallStore } from '@/stores/call'
import { useChatStore } from '@/stores/chat'

vi.mock('@/services/sound', () => ({
  useNotificationSoundEngine: () => ({
    playIncomingMessage: vi.fn(),
    startCallInviteRing: vi.fn().mockResolvedValue(undefined),
    stopCallInviteRing: vi.fn(),
  }),
}))

describe('callStore syncWithActiveCalls', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps external invited calls when conversation is not in sidebar lists', () => {
    const callStore = useCallStore()
    const chatStore = useChatStore()
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    callStore.activeConversationId = 'external-conversation'
    chatStore.channels = []
    chatStore.directMessages = []
    chatStore.activeCalls = []

    callStore.syncWithActiveCalls()

    expect(consoleInfoSpy).not.toHaveBeenCalledWith('[call-leave] leave requested', expect.anything())
    consoleInfoSpy.mockRestore()
  })

  it('leaves when known sidebar conversation no longer has active call', () => {
    const callStore = useCallStore()
    const chatStore = useChatStore()
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    callStore.activeConversationId = 'channel-1'
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.directMessages = []
    chatStore.activeCalls = []

    callStore.syncWithActiveCalls()

    expect(consoleInfoSpy).toHaveBeenCalledWith('[call-leave] leave requested', expect.objectContaining({
      conversationId: 'channel-1',
    }))
    consoleInfoSpy.mockRestore()
  })
})
