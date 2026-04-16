import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { Track } from 'livekit-client'
import { NotificationLevel } from '@/shared/proto/packets_pb'
import { useCallStore } from '@/stores/call'
import { useChatStore } from '@/stores/chat'
import { loadAudioPrefs, saveAudioPrefs } from '@/services/storage/audioPrefsStorage'

const platformMocks = vi.hoisted(() => ({
  getPlatformOrNull: vi.fn(),
  getRuntimePlatformType: vi.fn(),
  isTauriRuntime: vi.fn(),
}))

vi.mock('@/platform', () => ({
  getPlatformOrNull: platformMocks.getPlatformOrNull,
}))

vi.mock('@/platform/runtime', () => ({
  getRuntimePlatformType: platformMocks.getRuntimePlatformType,
  isTauriRuntime: platformMocks.isTauriRuntime,
}))

vi.mock('@/services/sound', () => ({
  useNotificationSoundEngine: () => ({
    playIncomingMessage: vi.fn(),
    startCallInviteRing: vi.fn().mockResolvedValue(undefined),
    stopCallInviteRing: vi.fn(),
  }),
}))

beforeEach(() => {
  platformMocks.getPlatformOrNull.mockReset()
  platformMocks.getPlatformOrNull.mockReturnValue(null)
  platformMocks.getRuntimePlatformType.mockReset()
  platformMocks.getRuntimePlatformType.mockReturnValue('pwa')
  platformMocks.isTauriRuntime.mockReset()
  platformMocks.isTauriRuntime.mockReturnValue(false)
})

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

describe('callStore switchInputDevice', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('persists the selected microphone and republishes local audio when mic is active', async () => {
    const callStore = useCallStore()
    const oldTrack = { sid: 'old-mic-track' }
    const setMicrophoneEnabled = vi.fn().mockResolvedValue(undefined)
    const unpublishTrack = vi.fn().mockResolvedValue(undefined)
    const getTrackPublication = vi.fn()
      .mockReturnValueOnce({ track: oldTrack })
      .mockReturnValueOnce(undefined)

    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        ...(originalMediaDevices ?? {}),
        getUserMedia: vi.fn(),
      },
    })

    try {
      callStore.room = {
        name: 'room-1',
        localParticipant: {
          identity: 'user-1',
          setMicrophoneEnabled,
          unpublishTrack,
          getTrackPublication,
        },
      } as never
      callStore.connected = true
      callStore.micEnabled = true

      const currentPrefs = loadAudioPrefs()
      saveAudioPrefs({
        ...currentPrefs,
        inputDeviceId: '',
      })

      await callStore.switchInputDevice('mic-2')

      expect(loadAudioPrefs().inputDeviceId).toBe('mic-2')
      expect(setMicrophoneEnabled).toHaveBeenNthCalledWith(1, false)
      expect(unpublishTrack).toHaveBeenCalledWith(oldTrack, true)
      expect(setMicrophoneEnabled).toHaveBeenNthCalledWith(
        2,
        true,
        expect.objectContaining({
          deviceId: 'mic-2',
        }),
      )
      expect(callStore.micEnabled).toBe(true)
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: originalMediaDevices,
      })
    }
  })
})

describe('callStore screen annotations', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function createTauriPlatform() {
    const invokeNative = vi.fn().mockResolvedValue(undefined)
    platformMocks.getPlatformOrNull.mockReturnValue({
      type: 'tauri',
      system: {
        invokeNative,
      },
    })
    platformMocks.getRuntimePlatformType.mockReturnValue('tauri')
    platformMocks.isTauriRuntime.mockReturnValue(true)
    return { invokeNative }
  }

  function createLocalSharerRoom(options?: {
    shareLabel?: string
    shareType?: 'monitor' | 'window' | 'browser'
  }) {
    let shareLabel = options?.shareLabel ?? 'Display 1'
    let shareType = options?.shareType ?? 'monitor'
    const mediaStreamTrack = {
      get label() {
        return shareLabel
      },
      getSettings: vi.fn(() => ({
        displaySurface: shareType,
      })),
    }
    const screenPublication = {
      track: {
        mediaStreamTrack,
      },
      isMuted: false,
    }
    const publishData = vi.fn().mockResolvedValue(undefined)
    const localParticipant = {
      identity: 'user-a',
      publishData,
      getTrackPublication: vi.fn((source: Track.Source) => (
        source === Track.Source.ScreenShare ? screenPublication : undefined
      )),
      setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
      videoTrackPublications: new Map(),
      audioTrackPublications: new Map(),
    }

    return {
      publishData,
      room: {
        name: 'room-annotation',
        disconnect: vi.fn().mockResolvedValue(undefined),
        localParticipant,
        remoteParticipants: new Map(),
      },
      setShareLabel(next: string) {
        shareLabel = next
      },
      setShareType(next: 'monitor' | 'window' | 'browser') {
        shareType = next
      },
    }
  }

  async function flushAsync() {
    await Promise.resolve()
    await Promise.resolve()
  }

  function buildInactiveSessionPacket() {
    return new TextEncoder().encode(JSON.stringify({
      version: 1,
      kind: 'session',
      active: false,
      sharerIdentity: 'user-a',
      sharerPlatform: 'tauri',
      shareType: 'unknown',
      shareLabel: '',
      sentAtMs: Date.now(),
    }))
  }

  it('allows non-sharer publish when sharer session supports annotation', async () => {
    const callStore = useCallStore()
    const publishData = vi.fn().mockResolvedValue(undefined)

    callStore.room = {
      localParticipant: {
        identity: 'user-b',
        publishData,
      },
      remoteParticipants: new Map(),
    } as never
    callStore.screenShareEnabled = false
    callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'session',
        active: true,
        sharerIdentity: 'user-a',
        sharerPlatform: 'tauri',
        shareType: 'monitor',
        shareLabel: 'Display 1',
        sentAtMs: Date.now(),
      })),
      'user-a',
    )

    const sent = await callStore.publishScreenAnnotationSegment({
      version: 1,
      kind: 'segment',
      shareTrackSid: 'remote-screen-track',
      senderIdentity: 'ignored-client-id',
      strokeId: 'stroke-1',
      seq: 0,
      from: { x: 0.1, y: 0.2 },
      to: { x: 0.3, y: 0.4 },
      sentAtMs: Date.now(),
    })

    expect(sent).toBe(true)
    expect(publishData).toHaveBeenCalledTimes(1)
    const encodedPayload = publishData.mock.calls[0]?.[0] as Uint8Array
    const publishOptions = publishData.mock.calls[0]?.[1] as { reliable: boolean; topic: string }
    expect(ArrayBuffer.isView(encodedPayload)).toBe(true)
    expect(publishOptions).toEqual(expect.objectContaining({
      reliable: false,
      topic: 'screen-annotation.v1',
    }))
    const decoded = JSON.parse(new TextDecoder().decode(encodedPayload)) as Record<string, unknown>
    expect(decoded.kind).toBe('segment')
    expect(decoded.senderIdentity).toBe('user-b')
  })

  it('blocks annotation publish for the screen sharer', async () => {
    const callStore = useCallStore()
    const publishData = vi.fn().mockResolvedValue(undefined)

    callStore.room = {
      localParticipant: {
        identity: 'user-a',
        publishData,
      },
      remoteParticipants: new Map(),
    } as never
    callStore.screenShareEnabled = true
    callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'session',
        active: true,
        sharerIdentity: 'user-a',
        sharerPlatform: 'tauri',
        shareType: 'monitor',
        shareLabel: 'Display 1',
        sentAtMs: Date.now(),
      })),
      'user-a',
    )

    const sent = await callStore.publishScreenAnnotationSegment({
      version: 1,
      kind: 'segment',
      shareTrackSid: 'local-screen-track',
      senderIdentity: 'user-a',
      strokeId: 'stroke-1',
      seq: 0,
      from: { x: 0.1, y: 0.2 },
      to: { x: 0.3, y: 0.4 },
      sentAtMs: Date.now(),
    })

    expect(sent).toBe(false)
    expect(publishData).not.toHaveBeenCalled()
  })

  it('disables annotation globally when sharer is non-tauri', async () => {
    const callStore = useCallStore()
    const publishData = vi.fn().mockResolvedValue(undefined)

    callStore.room = {
      localParticipant: {
        identity: 'user-b',
        publishData,
      },
      remoteParticipants: new Map(),
    } as never
    callStore.screenShareEnabled = false
    callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'session',
        active: true,
        sharerIdentity: 'user-a',
        sharerPlatform: 'pwa',
        shareType: 'monitor',
        shareLabel: 'Display 1',
        sentAtMs: Date.now(),
      })),
      'user-a',
    )

    expect(callStore.annotationAvailable).toBe(false)
    expect(callStore.annotationDisabledReason).toContain('not on Tauri')

    const sent = await callStore.publishScreenAnnotationSegment({
      version: 1,
      kind: 'segment',
      shareTrackSid: 'remote-screen-track',
      senderIdentity: 'user-b',
      strokeId: 'stroke-1',
      seq: 0,
      from: { x: 0.1, y: 0.2 },
      to: { x: 0.3, y: 0.4 },
      sentAtMs: Date.now(),
    })
    expect(sent).toBe(false)
    expect(publishData).not.toHaveBeenCalled()
  })

  it('parses session metadata and transitions annotation mode', () => {
    const callStore = useCallStore()

    const monitorAccepted = callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'session',
        active: true,
        sharerIdentity: 'user-a',
        sharerPlatform: 'tauri',
        shareType: 'monitor',
        shareLabel: 'Display 1',
        sentAtMs: Date.now(),
      })),
      'user-a',
    )
    expect(monitorAccepted).toBe(true)
    expect(callStore.annotationSessionMode).toBe('os-overlay')
    expect(callStore.annotationAvailable).toBe(true)

    const windowAccepted = callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'session',
        active: true,
        sharerIdentity: 'user-a',
        sharerPlatform: 'tauri',
        shareType: 'window',
        shareLabel: 'Code Window',
        sentAtMs: Date.now(),
      })),
      'user-a',
    )
    expect(windowAccepted).toBe(true)
    expect(callStore.annotationSessionMode).toBe('preview-fallback')

    const inactiveAccepted = callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'session',
        active: false,
        sharerIdentity: 'user-a',
        sharerPlatform: 'tauri',
        shareType: 'window',
        shareLabel: '',
        sentAtMs: Date.now(),
      })),
      'user-a',
    )
    expect(inactiveAccepted).toBe(true)
    expect(callStore.annotationAvailable).toBe(false)
    expect(callStore.annotationDisabledReason).toBe('No active screen share')
  })

  it('ignores malformed packets and emits valid segments even for sharer clients', () => {
    const callStore = useCallStore()
    callStore.screenShareEnabled = true

    const received: Array<{ senderIdentity: string; strokeId: string; seq: number }> = []
    const unsubscribe = callStore.onScreenAnnotation((event) => {
      received.push({
        senderIdentity: event.senderIdentity,
        strokeId: event.strokeId,
        seq: event.seq,
      })
    })

    const malformedAccepted = callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode('{"bad":true}'),
      'user-b',
    )
    expect(malformedAccepted).toBe(false)
    expect(received).toHaveLength(0)

    const validAccepted = callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'segment',
        shareTrackSid: 'remote-screen-track',
        senderIdentity: 'payload-user',
        strokeId: 'stroke-ok',
        seq: 7,
        from: { x: 0.25, y: 0.25 },
        to: { x: 0.5, y: 0.5 },
        sentAtMs: Date.now(),
      })),
      'participant-identity',
    )

    expect(validAccepted).toBe(true)
    expect(received).toEqual([{
      senderIdentity: 'participant-identity',
      strokeId: 'stroke-ok',
      seq: 7,
    }])

    unsubscribe()
  })

  it('republishes local session metadata when the shared monitor label changes', async () => {
    vi.useFakeTimers()
    try {
      const { invokeNative } = createTauriPlatform()
      const localShare = createLocalSharerRoom({ shareLabel: 'Display 1', shareType: 'monitor' })
      const callStore = useCallStore()

      callStore.room = localShare.room as never
      callStore.screenShareEnabled = true
      callStore.ingestScreenAnnotationPacket(
        new TextEncoder().encode(JSON.stringify({
          version: 1,
          kind: 'session',
          active: true,
          sharerIdentity: 'user-a',
          sharerPlatform: 'tauri',
          shareType: 'monitor',
          shareLabel: 'Display 1',
          sentAtMs: Date.now(),
        })),
        'user-a',
      )
      await flushAsync()

      localShare.publishData.mockClear()
      invokeNative.mockClear()
      localShare.setShareLabel('Display 2')

      await vi.advanceTimersByTimeAsync(600)
      await flushAsync()

      expect(localShare.publishData).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(new TextDecoder().decode(localShare.publishData.mock.calls[0][0]))
      expect(payload).toEqual(expect.objectContaining({
        kind: 'session',
        shareType: 'monitor',
        shareLabel: 'Display 2',
      }))
      expect(invokeNative).toHaveBeenCalledWith('annotation_overlay_show', expect.objectContaining({
        overlayLabel: 'annotation_overlay_monitor-1',
        shareLabel: 'Display 2',
      }))

      callStore.ingestScreenAnnotationPacket(buildInactiveSessionPacket(), 'user-a')
      await flushAsync()
    } finally {
      vi.useRealTimers()
    }
  })

  it('routes incoming sharer-side overlay segments to the current active monitor', async () => {
    const { invokeNative } = createTauriPlatform()
    const localShare = createLocalSharerRoom({ shareLabel: 'Display 2', shareType: 'monitor' })
    const callStore = useCallStore()

    callStore.room = localShare.room as never
    callStore.screenShareEnabled = true
    callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'session',
        active: true,
        sharerIdentity: 'user-a',
        sharerPlatform: 'tauri',
        shareType: 'monitor',
        shareLabel: 'Display 1',
        sentAtMs: Date.now(),
      })),
      'user-a',
    )
    await flushAsync()

    invokeNative.mockClear()
    const accepted = callStore.ingestScreenAnnotationPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        kind: 'segment',
        shareTrackSid: 'stale-track-sid',
        senderIdentity: 'user-b',
        strokeId: 'stroke-2',
        seq: 0,
        from: { x: 0.1, y: 0.1 },
        to: { x: 0.5, y: 0.5 },
        sentAtMs: Date.now(),
      })),
      'user-b',
    )
    await flushAsync()

    expect(accepted).toBe(true)
    expect(invokeNative).toHaveBeenCalledWith('annotation_overlay_show', expect.objectContaining({
      overlayLabel: 'annotation_overlay_monitor-1',
      shareLabel: 'Display 2',
    }))
    expect(invokeNative).toHaveBeenCalledWith('annotation_overlay_push_segment', expect.objectContaining({
      overlayLabel: 'annotation_overlay_monitor-1',
    }))

    callStore.ingestScreenAnnotationPacket(buildInactiveSessionPacket(), 'user-a')
    await flushAsync()
  })

  it('keeps prior monitor overlays during switches and clears all tracked overlays when the session stops', async () => {
    vi.useFakeTimers()
    try {
      const { invokeNative } = createTauriPlatform()
      const localShare = createLocalSharerRoom({ shareLabel: 'Display 1', shareType: 'monitor' })
      const callStore = useCallStore()

      callStore.room = localShare.room as never
      callStore.screenShareEnabled = true
      callStore.ingestScreenAnnotationPacket(
        new TextEncoder().encode(JSON.stringify({
          version: 1,
          kind: 'session',
          active: true,
          sharerIdentity: 'user-a',
          sharerPlatform: 'tauri',
          shareType: 'monitor',
          shareLabel: 'Display 1',
          sentAtMs: Date.now(),
        })),
        'user-a',
      )
      await flushAsync()

      invokeNative.mockClear()
      localShare.setShareLabel('Display 2')
      await vi.advanceTimersByTimeAsync(600)
      await flushAsync()

      expect(invokeNative).toHaveBeenCalledWith('annotation_overlay_show', expect.objectContaining({
        overlayLabel: 'annotation_overlay_monitor-1',
        shareLabel: 'Display 2',
      }))
      expect(invokeNative).not.toHaveBeenCalledWith('annotation_overlay_clear', expect.anything())
      expect(invokeNative).not.toHaveBeenCalledWith('annotation_overlay_hide', expect.anything())

      invokeNative.mockClear()
      callStore.ingestScreenAnnotationPacket(buildInactiveSessionPacket(), 'user-a')
      await flushAsync()

      expect(invokeNative).toHaveBeenCalledWith('annotation_overlay_clear', { overlayLabel: 'annotation_overlay_monitor-0' })
      expect(invokeNative).toHaveBeenCalledWith('annotation_overlay_hide', { overlayLabel: 'annotation_overlay_monitor-0' })
      expect(invokeNative).toHaveBeenCalledWith('annotation_overlay_clear', { overlayLabel: 'annotation_overlay_monitor-1' })
      expect(invokeNative).toHaveBeenCalledWith('annotation_overlay_hide', { overlayLabel: 'annotation_overlay_monitor-1' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('callStore remote screen share receive toggle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function createRemoteShareRoom() {
    const remoteAudioPublication = {
      trackSid: 'remote-audio-track',
      source: Track.Source.Microphone,
      isSubscribed: true,
      setSubscribed: vi.fn(),
    }
    const remoteCameraPublication = {
      trackSid: 'remote-camera-track',
      source: Track.Source.Camera,
      isSubscribed: true,
      setSubscribed: vi.fn(),
    }
    const remoteScreenPublication = {
      trackSid: 'remote-screen-track',
      source: Track.Source.ScreenShare,
      isSubscribed: true,
      setSubscribed: vi.fn(),
    }

    return {
      remoteAudioPublication,
      remoteCameraPublication,
      remoteScreenPublication,
      room: {
        localParticipant: {
          identity: 'user-a',
          videoTrackPublications: new Map(),
          audioTrackPublications: new Map(),
        },
        remoteParticipants: new Map([
          ['remote-sid', {
            sid: 'remote-sid',
            identity: 'user-b',
            audioTrackPublications: new Map([['mic', remoteAudioPublication]]),
            videoTrackPublications: new Map([
              ['camera', remoteCameraPublication],
              ['screen', remoteScreenPublication],
            ]),
          }],
        ]),
      },
    }
  }

  it('unsubscribes only the remote screen share for the local viewer and can resume it', () => {
    const callStore = useCallStore()
    const remoteShare = createRemoteShareRoom()

    callStore.room = remoteShare.room as never

    callStore.stopRemoteScreenShareForMe()

    expect(callStore.remoteScreenShareReceiveEnabled).toBe(false)
    expect(remoteShare.remoteScreenPublication.setSubscribed).toHaveBeenCalledWith(false)
    expect(remoteShare.remoteAudioPublication.setSubscribed).not.toHaveBeenCalled()
    expect(remoteShare.remoteCameraPublication.setSubscribed).not.toHaveBeenCalled()

    remoteShare.remoteScreenPublication.isSubscribed = false
    callStore.startRemoteScreenShareForMe()

    expect(callStore.remoteScreenShareReceiveEnabled).toBe(true)
    expect(remoteShare.remoteScreenPublication.setSubscribed).toHaveBeenLastCalledWith(true)
  })

  it('resets incoming remote screen share receive to enabled on leave and runtime reset', async () => {
    const callStore = useCallStore()

    callStore.remoteScreenShareReceiveEnabled = false
    await callStore.leaveCall()
    expect(callStore.remoteScreenShareReceiveEnabled).toBe(true)

    callStore.remoteScreenShareReceiveEnabled = false
    await callStore.resetRuntimeState()
    expect(callStore.remoteScreenShareReceiveEnabled).toBe(true)
  })

  it('keeps later remote screen publications blocked while still syncing other remote media', () => {
    const callStore = useCallStore()
    const firstRoom = createRemoteShareRoom()

    callStore.room = firstRoom.room as never
    callStore.stopRemoteScreenShareForMe()
    expect(callStore.remoteScreenShareReceiveEnabled).toBe(false)

    const remoteAudioPublication = {
      trackSid: 'remote-audio-track-b',
      source: Track.Source.Microphone,
      isSubscribed: false,
      setSubscribed: vi.fn(),
    }
    const remoteCameraPublication = {
      trackSid: 'remote-camera-track-b',
      source: Track.Source.Camera,
      isSubscribed: false,
      setSubscribed: vi.fn(),
    }
    const remoteScreenPublication = {
      trackSid: 'remote-screen-track-b',
      source: Track.Source.ScreenShare,
      isSubscribed: false,
      setSubscribed: vi.fn(),
    }

    callStore.room = {
      localParticipant: {
        identity: 'user-a',
        videoTrackPublications: new Map(),
        audioTrackPublications: new Map(),
      },
      remoteParticipants: new Map([
        ['remote-sid-b', {
          sid: 'remote-sid-b',
          identity: 'user-c',
          audioTrackPublications: new Map([['mic', remoteAudioPublication]]),
          videoTrackPublications: new Map([
            ['camera', remoteCameraPublication],
            ['screen', remoteScreenPublication],
          ]),
        }],
      ]),
    } as never

    callStore.stopRemoteScreenShareForMe()

    expect(remoteAudioPublication.setSubscribed).toHaveBeenCalledWith(true)
    expect(remoteCameraPublication.setSubscribed).toHaveBeenCalledWith(true)
    expect(remoteScreenPublication.setSubscribed).not.toHaveBeenCalled()
  })
})
