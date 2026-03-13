import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { Track } from 'livekit-client'
import { NotificationLevel } from '@/shared/proto/packets_pb'
import CallDock from '@/components/CallDock.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useCallStore } from '@/stores/call'

const chatApiMocks = vi.hoisted(() => ({
  listDmCandidates: vi.fn(),
}))

vi.mock('@/services/http/chatApi', () => ({
  listDmCandidates: chatApiMocks.listDmCandidates,
}))

async function flushAll() {
  await Promise.resolve()
  await nextTick()
}

function createVideoTrack(sid: string) {
  return {
    sid,
    kind: 'video',
    attach: vi.fn((el?: HTMLMediaElement) => el ?? document.createElement('video')),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
  }
}

function createLocalShareRoom() {
  const localScreenTrack = createVideoTrack('local-screen-track')
  const localScreenPublication = {
    trackSid: localScreenTrack.sid,
    source: Track.Source.ScreenShare,
    track: localScreenTrack,
    isMuted: false,
    isSubscribed: true,
    setSubscribed: vi.fn(),
  }
  return {
    trackSid: localScreenTrack.sid,
    room: {
      localParticipant: {
        sid: 'local-sid',
        identity: 'user-a',
        name: 'Ada',
        getTrackPublication: (source: Track.Source) => (
          source === Track.Source.ScreenShare ? localScreenPublication : undefined
        ),
        videoTrackPublications: new Map([['local-screen', localScreenPublication]]),
        audioTrackPublications: new Map(),
      },
      remoteParticipants: new Map(),
    },
  }
}

function createRemoteShareRoom() {
  const remoteScreenTrack = createVideoTrack('remote-screen-track')
  const remoteScreenPublication = {
    trackSid: remoteScreenTrack.sid,
    source: 'screen_share',
    track: remoteScreenTrack,
    isMuted: false,
    isSubscribed: true,
    setSubscribed: vi.fn(),
  }
  return {
    trackSid: remoteScreenTrack.sid,
    room: {
      localParticipant: {
        sid: 'local-sid',
        identity: 'user-a',
        name: 'Ada',
        getTrackPublication: () => undefined,
        videoTrackPublications: new Map(),
        audioTrackPublications: new Map(),
      },
      remoteParticipants: new Map([
        ['remote-sid', {
          sid: 'remote-sid',
          identity: 'user-b',
          name: 'Bob',
          getTrackPublication: () => undefined,
          videoTrackPublications: new Map([['remote-screen', remoteScreenPublication]]),
          audioTrackPublications: new Map(),
        }],
      ]),
    },
  }
}

type AnnotationPayload = {
  version: 1
  kind: 'segment'
  shareTrackSid: string
  senderIdentity: string
  strokeId: string
  seq: number
  from: { x: number; y: number }
  to: { x: number; y: number }
  sentAtMs: number
  receivedAtMs: number
}

function installAnnotationEmitter(callStore: ReturnType<typeof useCallStore>) {
  let listener: ((event: AnnotationPayload) => void) | undefined
  callStore.onScreenAnnotation = vi.fn((nextListener: (event: AnnotationPayload) => void) => {
    listener = nextListener
    return () => {
      listener = undefined
    }
  }) as unknown as typeof callStore.onScreenAnnotation
  return (event: AnnotationPayload) => {
    listener?.(event)
  }
}

describe('CallDock invite modal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads candidates and sends invite request from the call window', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const callStore = useCallStore()

    authStore.user = {
      id: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
      avatarUrl: '',
      role: 'member',
    }
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfAvatarUrl: '',
      selfRole: 'member',
    }
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]

    callStore.connected = true
    callStore.minimized = false
    callStore.activeConversationId = 'channel-1'
    callStore.inviteMembersToActiveCall = vi.fn().mockResolvedValue({
      invitedUserIds: ['user-2'],
      skippedUserIds: ['user-3'],
    })

    chatApiMocks.listDmCandidates.mockResolvedValue([
      { user_id: 'user-2', display_name: 'Bob', email: 'bob@example.com', avatar_url: '' },
      { user_id: 'user-3', display_name: 'Eve', email: 'eve@example.com', avatar_url: '' },
    ])

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })

    await wrapper.get('[data-testid="calldock-invite-button"]').trigger('click')
    await flushAll()

    expect(chatApiMocks.listDmCandidates).toHaveBeenCalledTimes(1)
    const modal = document.body.querySelector('[data-testid="calldock-invite-modal"]') as HTMLElement | null
    expect(modal).not.toBeNull()
    const modalText = modal?.textContent ?? ''
    expect(modalText).toContain('Bob')
    expect(modalText).toContain('Eve')
    expect(modalText).not.toContain('ada@example.com')

    const candidate2 = document.body.querySelector('[data-testid="calldock-invite-candidate-user-2"]') as HTMLElement | null
    const candidate3 = document.body.querySelector('[data-testid="calldock-invite-candidate-user-3"]') as HTMLElement | null
    expect(candidate2).not.toBeNull()
    expect(candidate3).not.toBeNull()
    await candidate2?.click()
    await candidate3?.click()
    await flushAll()

    const sendInvitesButton = document.body.querySelector('[data-testid="calldock-send-invites"]') as HTMLElement | null
    expect(sendInvitesButton).not.toBeNull()
    await sendInvitesButton?.click()
    await flushAll()

    expect(callStore.inviteMembersToActiveCall).toHaveBeenCalledWith(['user-2', 'user-3'])
    expect(document.body.querySelector('[data-testid="calldock-invite-modal"]')).toBeNull()

    wrapper.unmount()
  })

  it('restores from maximized mode when Escape is pressed', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const callStore = useCallStore()

    authStore.user = {
      id: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
      avatarUrl: '',
      role: 'member',
    }
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfAvatarUrl: '',
      selfRole: 'member',
    }

    callStore.connected = true
    callStore.minimized = false

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })

    await wrapper.get('button[title="Maximize"]').trigger('click')
    await flushAll()
    expect(wrapper.find('button[title="Restore"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushAll()
    expect(wrapper.find('button[title="Maximize"]').exists()).toBe(true)

    wrapper.unmount()
  })
})

describe('CallDock input device selector', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows input selector and switches active microphone device from the call window', async () => {
    const callStore = useCallStore()
    callStore.connected = true
    callStore.minimized = false
    callStore.switchInputDevice = vi.fn().mockResolvedValue(undefined)

    const originalMediaDevices = navigator.mediaDevices
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const enumerateDevices = vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in Mic' },
      { kind: 'audioinput', deviceId: 'mic-2', label: 'USB Mic' },
      { kind: 'audiooutput', deviceId: 'spk-1', label: 'Speakers' },
    ])
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices,
        addEventListener,
        removeEventListener,
      },
    })

    let wrapper: ReturnType<typeof mount> | null = null
    try {
      wrapper = mount(CallDock, {
        attachTo: document.body,
        global: {
          stubs: {
            UserAvatar: true,
          },
        },
      })

      await flushAll()

      const toggle = wrapper.get('[data-testid="calldock-input-device-toggle"]')
      await toggle.trigger('click')
      await flushAll()
      expect(wrapper.find('[data-testid="calldock-input-device-menu"]').exists()).toBe(true)

      const option = wrapper.get('[data-testid="calldock-input-device-option-mic-2"]')
      await option.trigger('click')
      await flushAll()

      expect(callStore.switchInputDevice).toHaveBeenCalledWith('mic-2')
      expect(enumerateDevices).toHaveBeenCalled()
    } finally {
      wrapper?.unmount()
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: originalMediaDevices,
      })
    }
  })
})

describe('CallDock screen annotation overlay', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function setAnnotationSession(
    callStore: ReturnType<typeof useCallStore>,
    session: {
      active?: boolean
      sharerIdentity: string
      sharerPlatform: 'tauri' | 'pwa'
      shareType: 'monitor' | 'window' | 'browser'
    },
  ) {
    callStore.annotationSessionState = {
      version: 1,
      kind: 'session',
      active: session.active ?? true,
      sharerIdentity: session.sharerIdentity,
      sharerPlatform: session.sharerPlatform,
      shareType: session.shareType,
      shareLabel: session.shareType === 'monitor' ? 'Display 1' : 'Shared Window',
      sentAtMs: Date.now(),
    }
  }

  function seedUserState() {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.user = {
      id: 'user-a',
      email: 'ada@example.com',
      displayName: 'Ada',
      avatarUrl: '',
      role: 'member',
    }
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-a',
      selfDisplayName: 'Ada',
      selfAvatarUrl: '',
      selfRole: 'member',
    }
  }

  it('shows pen toggle on browser runtime too', async () => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = undefined
    const callStore = useCallStore()
    callStore.connected = true
    callStore.minimized = false

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })
    await flushAll()
    expect(wrapper.find('[data-testid="calldock-annotation-toggle"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('disables pen for the active sharer', async () => {
    const callStore = useCallStore()
    const localShare = createLocalShareRoom()
    seedUserState()

    callStore.connected = true
    callStore.screenShareEnabled = true
    callStore.room = localShare.room as never
    callStore.mediaVersion = 1
    setAnnotationSession(callStore, {
      sharerIdentity: 'user-a',
      sharerPlatform: 'tauri',
      shareType: 'monitor',
    })

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })
    await flushAll()

    const overlay = wrapper.get('[data-testid="calldock-annotation-overlay"]')
    expect(overlay.attributes('data-surface-kind')).toBe('local')
    const drawToggle = wrapper.get('[data-testid="calldock-annotation-toggle"]').element as HTMLButtonElement
    expect(drawToggle.disabled).toBe(true)
    wrapper.unmount()
  })

  it('disables pen for everyone when sharer is non-tauri', async () => {
    const callStore = useCallStore()
    const remoteShare = createRemoteShareRoom()
    seedUserState()

    callStore.connected = true
    callStore.screenShareEnabled = false
    callStore.room = remoteShare.room as never
    callStore.mediaVersion = 1
    setAnnotationSession(callStore, {
      sharerIdentity: 'user-b',
      sharerPlatform: 'pwa',
      shareType: 'monitor',
    })

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })
    await flushAll()

    const overlay = wrapper.get('[data-testid="calldock-annotation-overlay"]')
    expect(overlay.attributes('data-surface-kind')).toBe('remote')
    const drawToggle = wrapper.get('[data-testid="calldock-annotation-toggle"]').element as HTMLButtonElement
    expect(drawToggle.disabled).toBe(true)
    expect(drawToggle.title).toContain('not on Tauri desktop')
    wrapper.unmount()
  })

  it('does not render incoming segments on viewer call canvas', async () => {
    const callStore = useCallStore()
    const remoteShare = createRemoteShareRoom()
    const emitAnnotation = installAnnotationEmitter(callStore)
    seedUserState()

    callStore.connected = true
    callStore.screenShareEnabled = false
    callStore.room = remoteShare.room as never
    callStore.mediaVersion = 1
    setAnnotationSession(callStore, {
      sharerIdentity: 'user-b',
      sharerPlatform: 'tauri',
      shareType: 'monitor',
    })

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })
    await flushAll()

    const overlay = wrapper.get('[data-testid="calldock-annotation-overlay"]')
    expect(overlay.attributes('data-surface-kind')).toBe('remote')

    emitAnnotation({
      version: 1,
      kind: 'segment',
      shareTrackSid: remoteShare.trackSid,
      senderIdentity: 'user-b',
      strokeId: 'stroke-3',
      seq: 0,
      from: { x: 0.15, y: 0.15 },
      to: { x: 0.5, y: 0.5 },
      sentAtMs: Date.now(),
      receivedAtMs: Date.now(),
    })
    await flushAll()
    expect(overlay.attributes('data-active-segments')).toBe('0')

    wrapper.unmount()
  })

  it('renders incoming segments for sharer preview-fallback sessions', async () => {
    const callStore = useCallStore()
    const localShare = createLocalShareRoom()
    const emitAnnotation = installAnnotationEmitter(callStore)
    seedUserState()

    callStore.connected = true
    callStore.screenShareEnabled = true
    callStore.room = localShare.room as never
    callStore.mediaVersion = 1
    setAnnotationSession(callStore, {
      sharerIdentity: 'user-a',
      sharerPlatform: 'tauri',
      shareType: 'window',
    })

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })
    await flushAll()

    const overlay = wrapper.get('[data-testid="calldock-annotation-overlay"]')
    emitAnnotation({
      version: 1,
      kind: 'segment',
      shareTrackSid: localShare.trackSid,
      senderIdentity: 'user-b',
      strokeId: 'stroke-4',
      seq: 0,
      from: { x: 0.05, y: 0.05 },
      to: { x: 0.25, y: 0.25 },
      sentAtMs: Date.now(),
      receivedAtMs: Date.now(),
    })
    await flushAll()
    expect(overlay.attributes('data-active-segments')).toBe('1')

    wrapper.unmount()
  })

  it('expires preview-fallback segments after 20 seconds and reports fade window', async () => {
    vi.useFakeTimers()
    const callStore = useCallStore()
    const localShare = createLocalShareRoom()
    const emitAnnotation = installAnnotationEmitter(callStore)
    seedUserState()

    callStore.connected = true
    callStore.screenShareEnabled = true
    callStore.room = localShare.room as never
    callStore.mediaVersion = 1
    setAnnotationSession(callStore, {
      sharerIdentity: 'user-a',
      sharerPlatform: 'tauri',
      shareType: 'window',
    })

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })
    await flushAll()

    const overlay = wrapper.get('[data-testid="calldock-annotation-overlay"]')
    emitAnnotation({
      version: 1,
      kind: 'segment',
      shareTrackSid: localShare.trackSid,
      senderIdentity: 'user-b',
      strokeId: 'stroke-5',
      seq: 0,
      from: { x: 0.05, y: 0.05 },
      to: { x: 0.25, y: 0.25 },
      sentAtMs: Date.now(),
      receivedAtMs: Date.now(),
    })
    await flushAll()
    expect(overlay.attributes('data-active-segments')).toBe('1')

    await vi.advanceTimersByTimeAsync(19_850)
    await flushAll()
    expect(Number(overlay.attributes('data-fading-segments'))).toBeGreaterThan(0)
    expect(overlay.attributes('data-active-segments')).toBe('1')

    await vi.advanceTimersByTimeAsync(400)
    await flushAll()
    expect(overlay.attributes('data-active-segments')).toBe('0')

    wrapper.unmount()
    vi.useRealTimers()
  })
})
