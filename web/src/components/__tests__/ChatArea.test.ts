import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { NotificationLevel } from '@/shared/proto/packets_pb'
import ChatArea from '@/components/ChatArea.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useCallStore } from '@/stores/call'
import { useWsStore } from '@/stores/ws'
import { listActiveCallMembers, listConversationMembers } from '@/services/http/chatApi'

vi.mock('@/services/http/chatApi', () => ({
  listActiveCallMembers: vi.fn(),
  listConversationMembers: vi.fn(),
  listMessageReactionUsers: vi.fn(),
}))

const listActiveCallMembersMock = vi.mocked(listActiveCallMembers)
const listConversationMembersMock = vi.mocked(listConversationMembers)

describe('ChatArea', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    listActiveCallMembersMock.mockResolvedValue([])
    listConversationMembersMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends a message using bootstrap self identity when auth user is not hydrated', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const wsStore = useWsStore()

    authStore.user = null
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfAvatarUrl: '/api/public/avatars/avatars/user-1/avatar.png',
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
    chatStore.activeChannelId = 'channel-1'
    wsStore.state = 'LIVE_SYNCED'
    wsStore.sendMessage = vi.fn()
    chatStore.addOptimisticMessage = vi.fn()

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: {
            template: '<button data-testid="emit-send" @click="$emit(\'send\', \'hello world\')">send</button>',
          },
        },
      },
    })

    await wrapper.get('[data-testid="emit-send"]').trigger('click')

    expect(chatStore.addOptimisticMessage).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'channel-1',
      senderId: 'user-1',
      senderName: 'Ada',
      senderAvatarUrl: '/api/public/avatars/avatars/user-1/avatar.png',
      body: 'hello world',
      sendStatus: 'sending',
    }))
    expect(wsStore.sendMessage).toHaveBeenCalledWith('channel-1', 'hello world', expect.any(String), undefined, [])
  })

  it('passes the conversation focus token to the main composer', () => {
    const chatStore = useChatStore()

    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.conversationComposerFocusToken = 7

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: {
            props: ['focusToken'],
            template: '<div data-testid="composer-focus-token">{{ focusToken }}</div>',
          },
        },
      },
    })

    expect(wrapper.get('[data-testid="composer-focus-token"]').text()).toBe('7')
  })

  it('sends a message when self display name is empty', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const wsStore = useWsStore()

    authStore.user = {
      id: 'user-1',
      displayName: '',
      email: 'user1@example.com',
      avatarUrl: '/api/public/avatars/avatars/user-1/auth-avatar.png',
      role: 'member',
    }
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    wsStore.state = 'LIVE_SYNCED'
    wsStore.sendMessage = vi.fn()
    chatStore.addOptimisticMessage = vi.fn()

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: {
            template: '<button data-testid="emit-send" @click="$emit(\'send\', \'hello world\')">send</button>',
          },
        },
      },
    })

    await wrapper.get('[data-testid="emit-send"]').trigger('click')

    expect(chatStore.addOptimisticMessage).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'channel-1',
      senderId: 'user-1',
      senderName: 'user1@example.com',
      senderAvatarUrl: '/api/public/avatars/avatars/user-1/auth-avatar.png',
      body: 'hello world',
      sendStatus: 'sending',
    }))
    expect(wsStore.sendMessage).toHaveBeenCalledWith('channel-1', 'hello world', expect.any(String), undefined, [])
  })

  it('renders the active direct message title when a dm is selected', () => {
    const chatStore = useChatStore()

    chatStore.directMessages = [{
      id: 'dm-1',
      userId: 'user-2',
      displayName: 'Bob',
      presence: 'online',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'dm-1'

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Bob')
  })

  it('passes derived thread reply count after refresh when thread summary is not loaded yet', () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [
        {
          id: 'root-1',
          channelId: 'channel-1',
          senderId: 'user-1',
          senderName: 'Ada',
          body: 'Root',
          channelSeq: 1n,
          threadSeq: 0n,
          mentionedUserIds: [],
          mentionEveryone: false,
          createdAt: '2026-03-06T00:00:00Z',
          reactions: [],
          myReactions: [],
        },
        {
          id: 'reply-1',
          channelId: 'channel-1',
          senderId: 'user-2',
          senderName: 'Bob',
          body: 'Reply',
          channelSeq: 2n,
          threadSeq: 1n,
          threadRootMessageId: 'root-1',
          mentionedUserIds: [],
          mentionEveryone: false,
          createdAt: '2026-03-06T00:01:00Z',
          reactions: [],
          myReactions: [],
        },
      ],
    }
    chatStore.threadSummaries = {}

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: {
            props: ['message', 'threadReplyCount'],
            template: '<div class="msg" :data-id="message.id" :data-replies="threadReplyCount"></div>',
          },
          MessageInput: true,
        },
      },
    })

    const rootNode = wrapper.find('[data-id="root-1"]')
    expect(rootNode.exists()).toBe(true)
    expect(rootNode.attributes('data-replies')).toBe('1')
  })

  it('forces scroll to bottom when sending a long message', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const wsStore = useWsStore()

    authStore.user = null
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
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
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [{
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'user-2',
        senderName: 'Bob',
        body: 'existing',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:00Z',
        reactions: [],
        myReactions: [],
      }],
    }
    wsStore.state = 'LIVE_SYNCED'
    wsStore.sendMessage = vi.fn()

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: {
            template: '<button data-testid="emit-send" @click="$emit(\'send\', longText)">send</button>',
            data: () => ({ longText: 'x'.repeat(2000) }),
          },
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
    el.scrollTop = 100

    await wrapper.get('[data-testid="emit-send"]').trigger('click')
    await nextTick()

    expect(el.scrollTop).toBe(2000)
    expect(wsStore.sendMessage).toHaveBeenCalledWith('channel-1', expect.any(String), expect.any(String), undefined, [])
  })

  it('loads older history when scrolled near top', async () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    chatStore.loadOlderConversationHistory = vi.fn().mockResolvedValue(1)
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [{
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'user-1',
        senderName: 'Ada',
        body: 'hello',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:00Z',
        reactions: [],
        myReactions: [],
      }],
    }

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true })
    el.scrollTop = 40

    await wrapper.find('.overflow-y-auto').trigger('scroll')
    await Promise.resolve()

    expect(chatStore.loadOlderConversationHistory).toHaveBeenCalledWith('channel-1')
  })

  it('re-arms top history preload only after leaving threshold zone', async () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    chatStore.loadOlderConversationHistory = vi.fn().mockResolvedValue(1)
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [{
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'user-1',
        senderName: 'Ada',
        body: 'hello',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:00Z',
        reactions: [],
        myReactions: [],
      }],
    }

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true })

    el.scrollTop = 40
    await wrapper.find('.overflow-y-auto').trigger('scroll')
    await Promise.resolve()
    expect(chatStore.loadOlderConversationHistory).toHaveBeenCalledTimes(1)

    el.scrollTop = 30
    await wrapper.find('.overflow-y-auto').trigger('scroll')
    await Promise.resolve()
    expect(chatStore.loadOlderConversationHistory).toHaveBeenCalledTimes(1)

    el.scrollTop = 240
    await wrapper.find('.overflow-y-auto').trigger('scroll')
    await Promise.resolve()

    el.scrollTop = 40
    await wrapper.find('.overflow-y-auto').trigger('scroll')
    await Promise.resolve()
    expect(chatStore.loadOlderConversationHistory).toHaveBeenCalledTimes(2)
  })

  it('shows spinner at top while loading older history', async () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'

    const deferredLoad: { resolve?: (value: number) => void } = {}
    chatStore.loadOlderConversationHistory = vi.fn().mockImplementation(() =>
      new Promise<number>((resolve) => {
        deferredLoad.resolve = resolve
      })
    )
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [{
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'user-1',
        senderName: 'Ada',
        body: 'hello',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:00Z',
        reactions: [],
        myReactions: [],
      }],
    }

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true })
    el.scrollTop = 40

    await wrapper.find('.overflow-y-auto').trigger('scroll')
    await nextTick()

    expect(wrapper.find('[data-testid="history-loading-spinner"]').exists()).toBe(true)

    deferredLoad.resolve?.(1)
  })

  it('shows centered overlay while initial conversation history is loading', () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = { 'channel-1': [] }
    chatStore.isConversationInitialLoading = vi.fn().mockReturnValue(true)

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    expect(wrapper.find('[data-testid="conversation-loading-overlay"]').exists()).toBe(true)
  })

  it('does not force-scroll to bottom when user is reading older history', async () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    chatStore.loadOlderConversationHistory = vi.fn().mockResolvedValue(0)
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [{
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'user-1',
        senderName: 'Ada',
        body: 'hello',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:00Z',
        reactions: [],
        myReactions: [],
      }],
    }

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 1500, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
    el.scrollTop = 120

    chatStore.messages['channel-1'].push({
      id: 'message-2',
      channelId: 'channel-1',
      senderId: 'user-2',
      senderName: 'Bob',
      body: 'new message',
      channelSeq: 2n,
      threadSeq: 0n,
      mentionedUserIds: [],
      mentionEveryone: false,
      createdAt: '2026-03-06T00:00:01Z',
      reactions: [],
      myReactions: [],
    })

    await Promise.resolve()

    expect(el.scrollTop).toBe(120)
  })

  it('opens thread panel from message bubble and subscribes to thread', async () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    wsStore.sendSubscribeThread = vi.fn()

    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [{
        id: 'root-1',
        channelId: 'channel-1',
        senderId: 'user-1',
        senderName: 'Ada',
        body: 'root',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:00Z',
        reactions: [],
        myReactions: [],
      }],
    }

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: {
            props: ['message'],
            template: '<button data-testid="open-thread" @click="$emit(\'openThread\', message)">open thread</button>',
          },
          MessageInput: true,
        },
      },
    })

    await wrapper.get('[data-testid="open-thread"]').trigger('click')

    expect(wsStore.sendSubscribeThread).toHaveBeenCalledWith('channel-1', 'root-1', 0n)
    expect(chatStore.isThreadPanelOpen).toBe(true)
  })

  it('sends thread reply from panel with thread root id', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    wsStore.sendMessage = vi.fn()
    wsStore.sendSubscribeThread = vi.fn()

    authStore.user = {
      id: 'user-1',
      displayName: 'Ada',
      email: 'ada@example.com',
      role: 'member',
    }
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [{
        id: 'root-1',
        channelId: 'channel-1',
        senderId: 'user-2',
        senderName: 'Bob',
        body: 'root',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:00Z',
        reactions: [],
        myReactions: [],
      }],
    }

    chatStore.openThread(chatStore.messages['channel-1'][0])
    await nextTick()

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: {
            props: ['channelName'],
            template: `
              <button
                data-testid="emit-send"
                @click="$emit('send', { body: 'thread reply', attachmentIds: [], attachments: [] })"
              >
                {{ channelName }}
              </button>
            `,
          },
        },
      },
    })

    const sendButtons = wrapper.findAll('[data-testid="emit-send"]')
    await sendButtons[1]?.trigger('click')

    expect(wsStore.sendMessage).toHaveBeenCalledWith('channel-1', 'thread reply', expect.any(String), 'root-1', [])
  })

  it('renders thread replies in ascending thread_seq order inside thread panel', async () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'

    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.messages = {
      'channel-1': [{
        id: 'root-1',
        channelId: 'channel-1',
        senderId: 'user-1',
        senderName: 'Ada',
        body: 'root',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:00Z',
        reactions: [],
        myReactions: [],
      }],
    }
    chatStore.threadMessages = {
      'root-1': [
        {
          id: 'reply-2',
          channelId: 'channel-1',
          senderId: 'user-2',
          senderName: 'Bob',
          body: 'reply 2',
          channelSeq: 3n,
          threadSeq: 2n,
          threadRootMessageId: 'root-1',
          mentionedUserIds: [],
          mentionEveryone: false,
          createdAt: '2026-03-06T00:00:02Z',
          reactions: [],
          myReactions: [],
        },
        {
          id: 'reply-1',
          channelId: 'channel-1',
          senderId: 'user-2',
          senderName: 'Bob',
          body: 'reply 1',
          channelSeq: 2n,
          threadSeq: 1n,
          threadRootMessageId: 'root-1',
          mentionedUserIds: [],
          mentionEveryone: false,
          createdAt: '2026-03-06T00:00:01Z',
          reactions: [],
          myReactions: [],
        },
      ],
    }
    chatStore.activeThreadConversationId = 'channel-1'
    chatStore.activeThreadRootId = 'root-1'

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: {
            props: ['message'],
            template: '<div class="bubble">{{ message.body }}|{{ message.threadSeq }}</div>',
          },
          MessageInput: true,
        },
      },
    })

    const bubbleText = wrapper.findAll('.bubble').map(item => item.text())
    const replyOneIndex = bubbleText.findIndex(text => text.includes('reply 1|1'))
    const replyTwoIndex = bubbleText.findIndex(text => text.includes('reply 2|2'))

    expect(replyOneIndex).toBeGreaterThan(-1)
    expect(replyTwoIndex).toBeGreaterThan(-1)
    expect(replyOneIndex).toBeLessThan(replyTwoIndex)
  })

  it('renders member avatars in the channel call invite dialog', async () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    listConversationMembersMock.mockResolvedValue([
      { user_id: 'user-2', display_name: 'Bob', email: 'bob@example.com', avatar_url: '/api/public/avatars/a/bob.png' },
      { user_id: 'user-3', display_name: '', email: 'eve@example.com', avatar_url: '' },
    ])

    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
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
    chatStore.activeChannelId = 'channel-1'

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
          UserAvatar: {
            props: ['userId', 'displayName', 'avatarUrl'],
            template: '<div :data-testid="`invite-avatar-${userId}`" :data-display-name="displayName" :data-avatar-url="avatarUrl"></div>',
          },
        },
      },
    })

    const callButton = wrapper.findAll('button').find(btn => btn.text().includes('Call'))
    expect(callButton).toBeDefined()
    await callButton!.trigger('click')
    await Promise.resolve()
    await nextTick()

    expect(listConversationMembersMock).toHaveBeenCalledWith('channel-1')
    expect(wrapper.find('[data-testid="invite-avatar-user-2"]').attributes('data-avatar-url')).toBe('/api/public/avatars/a/bob.png')
    expect(wrapper.find('[data-testid="invite-avatar-user-2"]').attributes('data-display-name')).toBe('Bob')
    expect(wrapper.find('[data-testid="invite-avatar-user-3"]').attributes('data-display-name')).toBe('eve@example.com')
  })

  it('shows the active call member roster on hover and includes the current user', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    const callStore = useCallStore()
    wsStore.state = 'LIVE_SYNCED'

    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfAvatarUrl: '/api/public/avatars/avatars/user-1/self.png',
      selfRole: 'member',
    }
    authStore.user = {
      id: 'user-1',
      displayName: 'Ada',
      email: 'ada@example.com',
      avatarUrl: '/api/public/avatars/avatars/user-1/self.png',
      role: 'member',
    }
    chatStore.registerUserIdentity('user-2', 'Bob', 'bob@example.com', '/api/public/avatars/avatars/user-2/bob.png')
    chatStore.registerUserIdentity('user-3', 'Eve', 'eve@example.com', '/api/public/avatars/avatars/user-3/eve.png')
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.activeCalls = [
      { id: 'call-1', conversationId: 'channel-1', status: '1', participantCount: 3 },
    ]
    callStore.activeConversationId = 'channel-1'
    callStore.room = {
      localParticipant: { identity: 'user-1' },
      remoteParticipants: new Map([
        ['sid-user-2', { identity: 'user-2' }],
        ['sid-user-3', { identity: 'user-3' }],
      ]),
    } as never

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
          UserAvatar: {
            props: ['userId', 'displayName', 'avatarUrl'],
            template: '<div :data-testid="`call-avatar-${userId}`" :data-display-name="displayName" :data-avatar-url="avatarUrl"></div>',
          },
        },
      },
    })

    const trigger = wrapper.get('[data-testid="active-call-members-trigger"]')
    await trigger.trigger('mouseenter')
    await nextTick()

    const popover = wrapper.get('[data-testid="call-members-popover"]')
    expect(popover.text()).toContain('Call members')
    expect(popover.text()).toContain('Ada')
    expect(popover.text()).toContain('Bob')
    expect(popover.text()).toContain('Eve')
    expect(popover.text()).toContain('You')
    expect(wrapper.get('[data-testid="call-avatar-user-1"]').attributes('data-avatar-url')).toBe('/api/public/avatars/avatars/user-1/self.png')
    expect(wrapper.get('[data-testid="call-avatar-user-2"]').attributes('data-display-name')).toBe('Bob')
    expect(wrapper.get('[data-testid="call-avatar-user-3"]').attributes('data-avatar-url')).toBe('/api/public/avatars/avatars/user-3/eve.png')

    callStore.room = {
      localParticipant: { identity: 'user-1' },
      remoteParticipants: new Map([
        ['sid-user-2', { identity: 'user-2' }],
        ['sid-user-4', { identity: 'user-4' }],
      ]),
    } as never
    chatStore.registerUserIdentity('user-4', 'Cara', 'cara@example.com', '/api/public/avatars/avatars/user-4/cara.png')
    callStore.mediaVersion += 1
    await nextTick()

    const updatedPopover = wrapper.get('[data-testid="call-members-popover"]')
    expect(updatedPopover.text()).toContain('Ada')
    expect(updatedPopover.text()).toContain('Bob')
    expect(updatedPopover.text()).toContain('Cara')
    expect(updatedPopover.text()).not.toContain('Eve')
  })

  it('loads active call members for calls the user has not joined', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    const callStore = useCallStore()
    wsStore.state = 'LIVE_SYNCED'

    authStore.user = {
      id: 'user-1',
      displayName: 'Ada',
      email: 'ada@example.com',
      avatarUrl: '/api/public/avatars/avatars/user-1/self.png',
      role: 'member',
    }
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfAvatarUrl: '/api/public/avatars/avatars/user-1/self.png',
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
    chatStore.activeChannelId = 'channel-1'
    chatStore.activeCalls = [
      { id: 'call-remote-1', conversationId: 'channel-1', status: '1', participantCount: 2 },
    ]
    callStore.activeConversationId = 'channel-2'
    callStore.room = {
      localParticipant: { identity: 'user-1' },
      remoteParticipants: new Map(),
    } as never
    listActiveCallMembersMock.mockResolvedValue([
      { user_id: 'user-2', display_name: 'Bob', email: 'bob@example.com', avatar_url: '/api/public/avatars/avatars/user-2/bob.png' },
      { user_id: 'user-3', display_name: '', email: 'eve@example.com', avatar_url: '' },
    ])

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
          UserAvatar: {
            props: ['userId', 'displayName', 'avatarUrl'],
            template: '<div :data-testid="`call-avatar-${userId}`" :data-display-name="displayName" :data-avatar-url="avatarUrl"></div>',
          },
        },
      },
    })

    await wrapper.get('[data-testid="active-call-members-trigger"]').trigger('mouseenter')
    await Promise.resolve()
    await nextTick()

    expect(listActiveCallMembersMock).toHaveBeenCalledWith('channel-1')
    expect(listActiveCallMembersMock).toHaveBeenCalledTimes(1)
    const popover = wrapper.get('[data-testid="call-members-popover"]')
    expect(popover.text()).toContain('Bob')
    expect(popover.text()).toContain('eve@example.com')
    expect(wrapper.get('[data-testid="call-avatar-user-2"]').attributes('data-avatar-url')).toBe('/api/public/avatars/avatars/user-2/bob.png')
    expect(wrapper.get('[data-testid="call-avatar-user-3"]').attributes('data-display-name')).toBe('eve@example.com')
  })

  it('does nothing when clicking call active while already in the same call', async () => {
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    const callStore = useCallStore()
    wsStore.state = 'LIVE_SYNCED'

    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chatStore.activeChannelId = 'channel-1'
    chatStore.activeCalls = [
      { id: 'call-1', conversationId: 'channel-1', status: '1', participantCount: 2 },
    ]

    callStore.connected = true
    callStore.connecting = false
    callStore.activeConversationId = 'channel-1'
    callStore.startOrJoinCall = vi.fn()

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    const callButton = wrapper.findAll('button').find(btn => btn.text().includes('Call active'))
    expect(callButton).toBeDefined()
    await callButton!.trigger('click')

    expect(callStore.startOrJoinCall).not.toHaveBeenCalled()
  })

  it('rate-limits typing notifications and hides them after one second of inactivity', async () => {
    vi.useFakeTimers()

    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const wsStore = useWsStore()

    authStore.user = {
      id: 'user-1',
      displayName: 'Ada',
      email: 'ada@example.com',
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
    chatStore.activeChannelId = 'channel-1'
    wsStore.state = 'LIVE_SYNCED'
    wsStore.sendTyping = vi.fn()

    const wrapper = mount(ChatArea, {
      global: {
        stubs: {
          ConnectionBanner: true,
          MembersPanel: true,
          MessageBubble: true,
          ThreadPanel: true,
          UserAvatar: true,
          MessageInput: {
            template: `
              <div>
                <button data-testid="typing-on" @click="$emit('typing', true)">typing-on</button>
                <button data-testid="typing-off" @click="$emit('typing', false)">typing-off</button>
              </div>
            `,
          },
        },
      },
    })

    await wrapper.get('[data-testid="typing-on"]').trigger('click')
    await wrapper.get('[data-testid="typing-on"]').trigger('click')

    expect(wsStore.sendTyping).toHaveBeenCalledTimes(1)
    expect(wsStore.sendTyping).toHaveBeenLastCalledWith('channel-1', true)

    await vi.advanceTimersByTimeAsync(1000)

    expect(wsStore.sendTyping).toHaveBeenCalledTimes(2)
    expect(wsStore.sendTyping).toHaveBeenLastCalledWith('channel-1', false)

    await wrapper.get('[data-testid="typing-off"]').trigger('click')

    expect(wsStore.sendTyping).toHaveBeenCalledTimes(2)
  })
})
