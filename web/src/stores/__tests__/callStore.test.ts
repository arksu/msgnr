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

describe('callStore leaveCall media cleanup', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stops local screen/camera/microphone capture tracks before disconnecting', async () => {
    const callStore = useCallStore()

    const cameraMediaTrackStop = vi.fn()
    const screenMediaTrackStop = vi.fn()
    const micMediaTrackStop = vi.fn()
    const cameraTrackStop = vi.fn()
    const screenTrackStop = vi.fn()
    const micTrackStop = vi.fn()

    const cameraPublication = {
      track: {
        stop: cameraTrackStop,
        mediaStreamTrack: { stop: cameraMediaTrackStop },
      },
    }
    const screenPublication = {
      track: {
        stop: screenTrackStop,
        mediaStreamTrack: { stop: screenMediaTrackStop },
      },
    }
    const micPublication = {
      track: {
        stop: micTrackStop,
        mediaStreamTrack: { stop: micMediaTrackStop },
      },
    }

    const localParticipant = {
      setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      unpublishTrack: vi.fn(),
      videoTrackPublications: new Map([
        ['camera', cameraPublication],
        ['screen', screenPublication],
      ]),
      audioTrackPublications: new Map([
        ['mic', micPublication],
      ]),
    }

    const room = {
      name: 'room-1',
      localParticipant,
      disconnect: vi.fn().mockResolvedValue(undefined),
    }

    callStore.room = room as never
    callStore.activeConversationId = 'channel-1'
    await callStore.leaveCall()

    expect(localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false)
    expect(localParticipant.setCameraEnabled).toHaveBeenCalledWith(false)
    expect(localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false)
    expect(localParticipant.unpublishTrack).toHaveBeenCalledTimes(3)
    expect(screenTrackStop).toHaveBeenCalledTimes(1)
    expect(screenMediaTrackStop).toHaveBeenCalledTimes(1)
    expect(cameraTrackStop).toHaveBeenCalledTimes(1)
    expect(cameraMediaTrackStop).toHaveBeenCalledTimes(1)
    expect(micTrackStop).toHaveBeenCalledTimes(1)
    expect(micMediaTrackStop).toHaveBeenCalledTimes(1)
    expect(room.disconnect).toHaveBeenCalledTimes(1)
  })
})
