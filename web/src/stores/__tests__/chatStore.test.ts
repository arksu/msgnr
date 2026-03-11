import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { create } from '@bufbuild/protobuf'
import { useChatStore } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'
import {
  loadLastOpenedConversation,
  saveLastOpenedConversation,
} from '@/services/storage/lastConversationStorage'
import {
  BootstrapResponseSchema,
  UserSummarySchema,
  ConversationSummarySchema,
  UnreadCounterSchema,
  CallStateChangedEventSchema,
  CallStatus,
  MessageEventSchema,
  SubscribeThreadResponseSchema,
  NotificationAddedEventSchema,
  NotificationSummarySchema,
  ReadCounterUpdatedEventSchema,
  ServerEventSchema,
  PresenceEventSchema,
  PresenceStatus,
  EventType,
} from '@/shared/proto/packets_pb'

const chatApiMocks = vi.hoisted(() => ({
  listConversationMessages: vi.fn(),
  listDmCandidates: vi.fn(),
}))

vi.mock('@/services/http/chatApi', () => ({
  listConversationMessages: chatApiMocks.listConversationMessages,
  listDmCandidates: chatApiMocks.listDmCandidates,
}))

describe('chatStore phase 6 flows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    chatApiMocks.listConversationMessages.mockReset()
    chatApiMocks.listDmCandidates.mockReset()
    chatApiMocks.listDmCandidates.mockResolvedValue([])
  })

  it('applies a bootstrap response into sidebar state and watermark', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.setLiveSynced = vi.fn()
    ws.sendAck = vi.fn()

    chat.handleBootstrapResponse(create(BootstrapResponseSchema, {
      snapshotSeq: 8n,
      userRole: 2,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
        selfUser: create(UserSummarySchema, { userId: 'user-1', displayName: 'Ada', avatarUrl: '' }),
        selfRole: 3,
      },
      conversations: [create(ConversationSummarySchema, {
        conversationId: 'channel-1',
        conversationType: 2,
        title: 'general',
        topic: '',
        isArchived: false,
        isMuted: false,
        lastMessageSeq: 0n,
        lastMessagePreview: '',
        memberCount: 1,
        presence: 3,
      })],
      unread: [create(UnreadCounterSchema, {
        conversationId: 'channel-1',
        unreadMessages: 4,
        unreadMentions: 0,
        hasUnreadThreadReplies: false,
        lastReadSeq: 0n,
      })],
      activeCalls: [],
      pendingInvites: [],
      notifications: [],
      hasMore: false,
      nextPageToken: '',
      bootstrapSessionId: 'session-1',
      pageIndex: 0,
      pageSizeEffective: 1,
      estimatedTotalConversations: 1,
      presence: [],
    }))

    expect(chat.bootstrapped).toBe(true)
    expect(chat.workspace?.name).toBe('Acme')
    expect(chat.workspace?.selfDisplayName).toBe('Ada')
    expect(chat.workspace?.selfRole).toBe('admin')
    expect(chat.channels).toHaveLength(1)
    expect(chat.channels[0].id).toBe('channel-1')
    expect(chat.channels[0].unread).toBe(4)
    expect(chat.lastAppliedEventSeq).toBe(8n)
    expect(ws.setLiveSynced).toHaveBeenCalled()
  })

  it('restores last opened conversation from local storage on bootstrap when still accessible', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.setLiveSynced = vi.fn()
    ws.sendAck = vi.fn()

    saveLastOpenedConversation('workspace-1', 'user-1', 'dm-1')

    chat.handleBootstrapResponse(create(BootstrapResponseSchema, {
      snapshotSeq: 10n,
      userRole: 2,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
        selfUser: create(UserSummarySchema, { userId: 'user-1', displayName: 'Ada', avatarUrl: '' }),
        selfRole: 3,
      },
      conversations: [
        create(ConversationSummarySchema, {
          conversationId: 'channel-1',
          conversationType: 2,
          title: 'general',
          topic: '',
          isArchived: false,
          isMuted: false,
          lastMessageSeq: 0n,
          lastMessagePreview: '',
          memberCount: 1,
          presence: 3,
        }),
        create(ConversationSummarySchema, {
          conversationId: 'dm-1',
          conversationType: 1,
          title: 'Bob',
          topic: 'user-2',
          isArchived: false,
          isMuted: false,
          lastMessageSeq: 0n,
          lastMessagePreview: '',
          memberCount: 2,
          presence: 3,
        }),
      ],
      unread: [],
      activeCalls: [],
      pendingInvites: [],
      notifications: [],
      hasMore: false,
      nextPageToken: '',
      bootstrapSessionId: 'session-restore',
      pageIndex: 0,
      pageSizeEffective: 2,
      estimatedTotalConversations: 2,
      presence: [],
    }))

    expect(chat.activeChannelId).toBe('dm-1')
  })

  it('falls back to first public channel when persisted conversation is inaccessible', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.setLiveSynced = vi.fn()
    ws.sendAck = vi.fn()

    saveLastOpenedConversation('workspace-1', 'user-1', 'missing-conversation')

    chat.handleBootstrapResponse(create(BootstrapResponseSchema, {
      snapshotSeq: 10n,
      userRole: 2,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
        selfUser: create(UserSummarySchema, { userId: 'user-1', displayName: 'Ada', avatarUrl: '' }),
        selfRole: 3,
      },
      conversations: [
        create(ConversationSummarySchema, {
          conversationId: 'channel-private-1',
          conversationType: 3,
          title: 'private-team',
          topic: '',
          isArchived: false,
          isMuted: false,
          lastMessageSeq: 0n,
          lastMessagePreview: '',
          memberCount: 1,
          presence: 3,
        }),
        create(ConversationSummarySchema, {
          conversationId: 'channel-public-1',
          conversationType: 2,
          title: 'general',
          topic: '',
          isArchived: false,
          isMuted: false,
          lastMessageSeq: 0n,
          lastMessagePreview: '',
          memberCount: 1,
          presence: 3,
        }),
      ],
      unread: [],
      activeCalls: [],
      pendingInvites: [],
      notifications: [],
      hasMore: false,
      nextPageToken: '',
      bootstrapSessionId: 'session-fallback-public',
      pageIndex: 0,
      pageSizeEffective: 2,
      estimatedTotalConversations: 2,
      presence: [],
    }))

    expect(chat.activeChannelId).toBe('channel-public-1')
  })

  it('keeps no selection when persisted conversation is inaccessible and no public channel exists', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.setLiveSynced = vi.fn()
    ws.sendAck = vi.fn()

    saveLastOpenedConversation('workspace-1', 'user-1', 'missing-conversation')

    chat.handleBootstrapResponse(create(BootstrapResponseSchema, {
      snapshotSeq: 10n,
      userRole: 2,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
        selfUser: create(UserSummarySchema, { userId: 'user-1', displayName: 'Ada', avatarUrl: '' }),
        selfRole: 3,
      },
      conversations: [
        create(ConversationSummarySchema, {
          conversationId: 'channel-private-1',
          conversationType: 3,
          title: 'private-team',
          topic: '',
          isArchived: false,
          isMuted: false,
          lastMessageSeq: 0n,
          lastMessagePreview: '',
          memberCount: 1,
          presence: 3,
        }),
        create(ConversationSummarySchema, {
          conversationId: 'dm-1',
          conversationType: 1,
          title: 'Bob',
          topic: 'user-2',
          isArchived: false,
          isMuted: false,
          lastMessageSeq: 0n,
          lastMessagePreview: '',
          memberCount: 2,
          presence: 3,
        }),
      ],
      unread: [],
      activeCalls: [],
      pendingInvites: [],
      notifications: [],
      hasMore: false,
      nextPageToken: '',
      bootstrapSessionId: 'session-fallback-empty',
      pageIndex: 0,
      pageSizeEffective: 2,
      estimatedTotalConversations: 2,
      presence: [],
    }))

    expect(chat.activeChannelId).toBe('')
  })

  it('stores selected conversation in local storage after user selection', () => {
    const chat = useChatStore()
    chat.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      lastMessageSeq: 1n,
    }]

    chat.selectChannel('channel-1')

    expect(loadLastOpenedConversation('workspace-1', 'user-1')).toBe('channel-1')
  })

  it('requests SyncSince when a live event arrives with a gap', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendSyncSince = vi.fn()
    ws.setRecoveringGap = vi.fn()

    chat.bootstrapped = true
    chat.lastAppliedEventSeq = 5n

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 7n,
      eventId: 'evt-7',
      eventType: 4,
      conversationId: 'channel-1',
      payload: {
        case: 'messageCreated',
        value: create(MessageEventSchema, {
          conversationId: 'channel-1',
          messageId: 'message-7',
          senderId: 'user-1',
          body: 'hello',
          channelSeq: 7n,
          threadRootMessageId: '',
          threadSeq: 0n,
          mentionedUserIds: [],
          mentionEveryone: false,
        }),
      },
    }))

    expect(ws.setRecoveringGap).toHaveBeenCalled()
    expect(ws.sendSyncSince).toHaveBeenCalledWith(5n, 200)
  })

  it('sends UpdateReadCursor when selecting a conversation with unread messages', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendUpdateReadCursor = vi.fn()

    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 3,
      lastMessageSeq: 12n,
    }]

    chat.selectChannel('channel-1')

    expect(ws.sendUpdateReadCursor).toHaveBeenCalledWith('channel-1', 12n)
    expect(chat.channels[0].unread).toBe(0)
  })

  it('defers read mark for opened conversation while tab is hidden and flushes on focus', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendUpdateReadCursor = vi.fn()
    chat.setClientActive(false)

    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 3,
      lastMessageSeq: 12n,
    }]

    chat.selectChannel('channel-1')

    expect(ws.sendUpdateReadCursor).not.toHaveBeenCalled()
    expect(chat.channels[0].unread).toBe(3)

    chat.setClientActive(true)
    chat.onClientFocus()

    expect(ws.sendUpdateReadCursor).toHaveBeenCalledWith('channel-1', 12n)
    expect(chat.channels[0].unread).toBe(0)
  })

  it('updates live presence for direct messages', () => {
    const chat = useChatStore()

    chat.directMessages = [{
      id: 'dm-1',
      userId: 'user-2',
      displayName: 'Bob',
      presence: 'offline',
      unread: 0,
    }]

    chat.handlePresenceEvent(create(PresenceEventSchema, {
      userId: 'user-2',
      effectivePresence: PresenceStatus.ONLINE,
    }))

    expect(chat.presenceByUserId['user-2']?.effectivePresence).toBe(PresenceStatus.ONLINE)
    expect(chat.directMessages[0].presence).toBe('online')
  })

  it('hydrates DM peer user id from bootstrap and applies later presence updates', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.setLiveSynced = vi.fn()
    ws.sendAck = vi.fn()

    chat.handleBootstrapResponse(create(BootstrapResponseSchema, {
      snapshotSeq: 11n,
      userRole: 2,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
        selfUser: create(UserSummarySchema, { userId: 'self-user', displayName: 'Self', avatarUrl: '' }),
        selfRole: 3,
      },
      conversations: [create(ConversationSummarySchema, {
        conversationId: 'dm-conversation-1',
        conversationType: 1,
        title: 'Bob',
        topic: 'peer-user-1',
        isArchived: false,
        isMuted: false,
        lastMessageSeq: 0n,
        lastMessagePreview: '',
        memberCount: 2,
        presence: 3,
      })],
      unread: [],
      activeCalls: [],
      pendingInvites: [],
      notifications: [],
      hasMore: false,
      nextPageToken: '',
      bootstrapSessionId: 'session-dm',
      pageIndex: 0,
      pageSizeEffective: 1,
      estimatedTotalConversations: 1,
      presence: [],
    }))

    expect(chat.directMessages).toHaveLength(1)
    expect(chat.directMessages[0].userId).toBe('peer-user-1')
    expect(chat.directMessages[0].presence).toBe('offline')

    chat.handlePresenceEvent(create(PresenceEventSchema, {
      userId: 'peer-user-1',
      effectivePresence: PresenceStatus.ONLINE,
    }))

    expect(chat.directMessages[0].presence).toBe('online')
  })

  it('hydrates DM avatar from user directory after bootstrap refresh', async () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.setLiveSynced = vi.fn()
    ws.sendAck = vi.fn()
    chatApiMocks.listDmCandidates.mockResolvedValue([
      {
        user_id: 'peer-user-1',
        display_name: 'Bob',
        email: 'bob@example.com',
        avatar_url: '/api/public/avatars/avatars/peer-user-1/avatar.png',
      },
    ])

    chat.handleBootstrapResponse(create(BootstrapResponseSchema, {
      snapshotSeq: 12n,
      userRole: 2,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
        selfUser: create(UserSummarySchema, { userId: 'self-user', displayName: 'Self', avatarUrl: '' }),
        selfRole: 3,
      },
      conversations: [create(ConversationSummarySchema, {
        conversationId: 'dm-conversation-1',
        conversationType: 1,
        title: 'Bob',
        topic: 'peer-user-1',
        isArchived: false,
        isMuted: false,
        lastMessageSeq: 0n,
        lastMessagePreview: '',
        memberCount: 2,
        presence: 1,
      })],
      unread: [],
      activeCalls: [],
      pendingInvites: [],
      notifications: [],
      hasMore: false,
      nextPageToken: '',
      bootstrapSessionId: 'session-dm-avatar',
      pageIndex: 0,
      pageSizeEffective: 1,
      estimatedTotalConversations: 1,
      presence: [],
    }))

    await vi.waitFor(() => {
      expect(chatApiMocks.listDmCandidates).toHaveBeenCalledTimes(1)
      expect(chat.directMessages[0].avatarUrl).toBe('/api/public/avatars/avatars/peer-user-1/avatar.png')
    })
  })

  it('applies optimistic reaction and rolls back when ack fails', () => {
    const chat = useChatStore()

    chat.messages = {
      'channel-1': [{
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'user-2',
        senderName: 'Bob',
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

    chat.queueReactionOp('op-1', 'channel-1', 'message-1', ':+1:', 'add')
    expect(chat.messages['channel-1'][0].reactions).toEqual([{ emoji: ':+1:', count: 1 }])
    expect(chat.messages['channel-1'][0].myReactions).toEqual([':+1:'])

    chat.handleReactionAck({
      ok: false,
      messageId: 'message-1',
      emoji: ':+1:',
      clientOpId: 'op-1',
      applied: false,
    } as any)

    expect(chat.messages['channel-1'][0].reactions).toEqual([])
    expect(chat.messages['channel-1'][0].myReactions).toEqual([])
    expect(chat.toast?.message).toBe('Reaction failed. Try again.')
  })

  it('rolls back optimistic reaction when ack is ok but not applied', () => {
    const chat = useChatStore()

    chat.messages = {
      'channel-1': [{
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'user-2',
        senderName: 'Bob',
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

    chat.queueReactionOp('op-2', 'channel-1', 'message-1', ':+1:', 'add')
    expect(chat.messages['channel-1'][0].reactions).toEqual([{ emoji: ':+1:', count: 1 }])
    expect(chat.messages['channel-1'][0].myReactions).toEqual([':+1:'])

    chat.handleReactionAck({
      ok: true,
      messageId: 'message-1',
      emoji: ':+1:',
      clientOpId: 'op-2',
      applied: false,
    } as any)

    expect(chat.messages['channel-1'][0].reactions).toEqual([])
    expect(chat.messages['channel-1'][0].myReactions).toEqual([])
  })

  it('advances read cursor when a new message arrives in the active conversation', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendUpdateReadCursor = vi.fn()
    chat.setClientActive(true)

    chat.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      lastMessageSeq: 1n,
    }]
    chat.activeChannelId = 'channel-1'
    chat.bootstrapped = true

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 1n,
      eventId: 'evt-1',
      eventType: 4,
      conversationId: 'channel-1',
      payload: {
        case: 'messageCreated',
        value: create(MessageEventSchema, {
          conversationId: 'channel-1',
          messageId: 'message-1',
          senderId: 'user-2',
          body: 'hello',
          channelSeq: 2n,
        }),
      },
    }))

    expect(ws.sendUpdateReadCursor).toHaveBeenCalledWith('channel-1', 2n)
  })

  it('resolves unknown WS sender name using email fallback from user directory', async () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendUpdateReadCursor = vi.fn()
    chat.setClientActive(true)
    chatApiMocks.listDmCandidates.mockResolvedValue([
      {
        user_id: 'user-2',
        display_name: '',
        email: 'user2@example.com',
        avatar_url: '',
      },
    ])

    chat.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      lastMessageSeq: 1n,
    }]
    chat.activeChannelId = 'channel-1'
    chat.bootstrapped = true

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 1n,
      eventId: 'evt-unknown-sender',
      eventType: 4,
      conversationId: 'channel-1',
      payload: {
        case: 'messageCreated',
        value: create(MessageEventSchema, {
          conversationId: 'channel-1',
          messageId: 'message-1',
          senderId: 'user-2',
          body: 'hello',
          channelSeq: 2n,
        }),
      },
    }))

    await vi.waitFor(() => {
      expect(chatApiMocks.listDmCandidates).toHaveBeenCalledTimes(1)
      expect(chat.resolveDisplayName('user-2')).toBe('user2@example.com')
      expect(chat.messages['channel-1'][0].senderName).toBe('user2@example.com')
    })
  })

  it('triggers bootstrap refresh when notification references an unknown conversation', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendBootstrap = vi.fn()
    ws.sendAck = vi.fn()
    ws.state = 'LIVE_SYNCED'
    chat.bootstrapped = true

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 1n,
      eventId: 'evt-notif-1',
      eventType: EventType.NOTIFICATION_ADDED,
      conversationId: 'private-1',
      payload: {
        case: 'notificationAdded',
        value: create(NotificationAddedEventSchema, {
          userId: 'user-1',
          notification: create(NotificationSummarySchema, {
            notificationId: 'notification-1',
            type: 5,
            title: 'Added to #secret',
            body: 'You were added to a private channel.',
            conversationId: 'private-1',
            isRead: false,
          }),
        }),
      },
    }))

    expect(ws.sendBootstrap).toHaveBeenCalledTimes(1)
  })

  it('tracks active calls from call_state_changed ACTIVE and ENDED events', () => {
    const chat = useChatStore()
    chat.bootstrapped = true
    chat.lastAppliedEventSeq = 0n

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 1n,
      eventId: 'evt-call-active-1',
      eventType: EventType.CALL_STATE_CHANGED,
      conversationId: 'channel-1',
      payload: {
        case: 'callStateChanged',
        value: create(CallStateChangedEventSchema, {
          callId: 'call-1',
          conversationId: 'channel-1',
          status: CallStatus.ACTIVE,
        }),
      },
    }))

    expect(chat.activeCalls).toHaveLength(1)
    expect(chat.activeCalls[0].id).toBe('call-1')
    expect(chat.activeCalls[0].conversationId).toBe('channel-1')

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 2n,
      eventId: 'evt-call-ended-1',
      eventType: EventType.CALL_STATE_CHANGED,
      conversationId: 'channel-1',
      payload: {
        case: 'callStateChanged',
        value: create(CallStateChangedEventSchema, {
          callId: 'call-1',
          conversationId: 'channel-1',
          status: CallStatus.ENDED,
        }),
      },
    }))

    expect(chat.activeCalls).toEqual([])
  })

  it('defers active-conversation read mark when tab is hidden and flushes on focus', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendUpdateReadCursor = vi.fn()
    chat.setClientActive(false)

    chat.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      lastMessageSeq: 1n,
    }]
    chat.activeChannelId = 'channel-1'
    chat.bootstrapped = true

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 1n,
      eventId: 'evt-hidden-1',
      eventType: 4,
      conversationId: 'channel-1',
      payload: {
        case: 'messageCreated',
        value: create(MessageEventSchema, {
          conversationId: 'channel-1',
          messageId: 'message-hidden-1',
          senderId: 'user-2',
          body: 'hidden hello',
          channelSeq: 2n,
        }),
      },
    }))

    expect(ws.sendUpdateReadCursor).not.toHaveBeenCalled()
    expect(chat.channels[0].unread).toBe(1)

    chat.setClientActive(true)
    chat.onClientFocus()

    expect(ws.sendUpdateReadCursor).toHaveBeenCalledWith('channel-1', 2n)
    expect(chat.channels[0].unread).toBe(0)
  })

  it('defers active-conversation read mark when window is blurred (visibility still visible)', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendUpdateReadCursor = vi.fn()
    chat.setClientActive(false)

    chat.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      lastMessageSeq: 1n,
    }]
    chat.activeChannelId = 'channel-1'
    chat.bootstrapped = true

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 1n,
      eventId: 'evt-blur-1',
      eventType: 4,
      conversationId: 'channel-1',
      payload: {
        case: 'messageCreated',
        value: create(MessageEventSchema, {
          conversationId: 'channel-1',
          messageId: 'message-blur-1',
          senderId: 'user-2',
          body: 'blur hello',
          channelSeq: 2n,
        }),
      },
    }))

    expect(ws.sendUpdateReadCursor).not.toHaveBeenCalled()
    expect(chat.channels[0].unread).toBe(1)

    chat.setClientActive(true)
    chat.onClientFocus()

    expect(ws.sendUpdateReadCursor).toHaveBeenCalledWith('channel-1', 2n)
    expect(chat.channels[0].unread).toBe(0)
  })

  it('marks active direct message as read for self-authored messages', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendUpdateReadCursor = vi.fn()
    chat.setClientActive(true)

    chat.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chat.directMessages = [{
      id: 'dm-1',
      userId: 'user-2',
      displayName: 'Bob',
      unread: 0,
      presence: 'online',
      lastMessageSeq: 1n,
    }]
    chat.activeChannelId = 'dm-1'
    chat.bootstrapped = true

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 1n,
      eventId: 'evt-self-dm-1',
      eventType: EventType.MESSAGE_CREATED,
      conversationId: 'dm-1',
      payload: {
        case: 'messageCreated',
        value: create(MessageEventSchema, {
          conversationId: 'dm-1',
          messageId: 'message-self-dm-1',
          senderId: 'user-1',
          body: 'my own message',
          channelSeq: 2n,
        }),
      },
    }))

    expect(ws.sendUpdateReadCursor).toHaveBeenCalledWith('dm-1', 2n)
    expect(chat.directMessages[0].unread).toBe(0)
  })

  it('applies direct unsequenced read-counter updates immediately', () => {
    const chat = useChatStore()

    chat.bootstrapped = true
    chat.lastAppliedEventSeq = 5n
    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 4,
      hasUnreadThreadReplies: true,
      lastMessageSeq: 5n,
    }]

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 0n,
      eventType: EventType.READ_COUNTER_UPDATED,
      conversationId: 'channel-1',
      payload: {
        case: 'readCounterUpdated',
        value: create(ReadCounterUpdatedEventSchema, {
          userId: 'user-1',
          counter: create(UnreadCounterSchema, {
            conversationId: 'channel-1',
            unreadMessages: 0,
            unreadMentions: 0,
            hasUnreadThreadReplies: false,
            lastReadSeq: 5n,
          }),
        }),
      },
    }))

    expect(chat.channels[0].unread).toBe(0)
    expect(chat.channels[0].hasUnreadThreadReplies).toBe(false)
    expect(chat.lastAppliedEventSeq).toBe(5n)
  })

  it('uses currentThreadSeq as authoritative thread reply total on subscribe replay', () => {
    const chat = useChatStore()
    chat.threadSummaries = {
      'root-1': {
        replyCount: 8,
        lastThreadSeq: 8n,
      },
    }

    chat.handleSubscribeThreadResponse(create(SubscribeThreadResponseSchema, {
      conversationId: 'channel-1',
      threadRootMessageId: 'root-1',
      currentThreadSeq: 10n,
      replay: [
        create(MessageEventSchema, {
          conversationId: 'channel-1',
          messageId: 'reply-9',
          senderId: 'user-2',
          body: 'reply 9',
          channelSeq: 20n,
          threadRootMessageId: 'root-1',
          threadSeq: 9n,
        }),
        create(MessageEventSchema, {
          conversationId: 'channel-1',
          messageId: 'reply-10',
          senderId: 'user-2',
          body: 'reply 10',
          channelSeq: 21n,
          threadRootMessageId: 'root-1',
          threadSeq: 10n,
        }),
      ],
    }))

    expect(chat.threadSummaries['root-1'].replyCount).toBe(10)
    expect(chat.threadSummaries['root-1'].lastThreadSeq).toBe(10n)
  })

  it('subscribes from zero when only summary exists but thread replay cache is empty', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendSubscribeThread = vi.fn()

    chat.threadSummaries = {
      'root-1': {
        replyCount: 3,
        lastThreadSeq: 3n,
      },
    }

    chat.openThread({
      id: 'root-1',
      channelId: 'channel-1',
      senderId: 'user-2',
      senderName: 'Bob',
      body: 'root',
      channelSeq: 10n,
      threadSeq: 0n,
      mentionedUserIds: [],
      mentionEveryone: false,
      createdAt: '2026-03-06T00:00:00Z',
      reactions: [],
      myReactions: [],
    })

    expect(ws.sendSubscribeThread).toHaveBeenCalledWith('channel-1', 'root-1', 0n)
  })

  it('restores persisted thread summaries after bootstrap refresh', () => {
    localStorage.setItem('msgnr:thread-summaries:v1', JSON.stringify({
      'user-1': {
        'root-1': {
          replyCount: 4,
          lastThreadSeq: '4',
          lastReplyAt: '2026-03-06T00:04:00Z',
          lastReplyUserId: 'user-2',
        },
      },
    }))

    const chat = useChatStore()
    const ws = useWsStore()
    ws.setLiveSynced = vi.fn()
    ws.sendAck = vi.fn()

    chat.handleBootstrapResponse(create(BootstrapResponseSchema, {
      snapshotSeq: 12n,
      userRole: 2,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
        selfUser: create(UserSummarySchema, { userId: 'user-1', displayName: 'Ada', avatarUrl: '' }),
        selfRole: 3,
      },
      conversations: [create(ConversationSummarySchema, {
        conversationId: 'channel-1',
        conversationType: 2,
        title: 'general',
        topic: '',
        isArchived: false,
        isMuted: false,
        lastMessageSeq: 0n,
        lastMessagePreview: '',
        memberCount: 1,
        presence: 3,
      })],
      unread: [],
      activeCalls: [],
      pendingInvites: [],
      notifications: [],
      hasMore: false,
      nextPageToken: '',
      bootstrapSessionId: 'session-restore-thread',
      pageIndex: 0,
      pageSizeEffective: 1,
      estimatedTotalConversations: 1,
      presence: [],
    }))

    expect(chat.threadSummaries['root-1']).toEqual({
      replyCount: 4,
      lastThreadSeq: 4n,
      lastReplyAt: '2026-03-06T00:04:00Z',
      lastReplyUserId: 'user-2',
    })
  })

  it('marks conversation with unread thread replies when receiving non-self thread reply', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.state = 'LIVE_SYNCED'

    chat.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chat.bootstrapped = true
    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      hasUnreadThreadReplies: false,
    }]

    chat.handleServerEvent(create(ServerEventSchema, {
      eventSeq: 1n,
      eventId: 'evt-thread-1',
      eventType: EventType.MESSAGE_CREATED,
      conversationId: 'channel-1',
      payload: {
        case: 'messageCreated',
        value: create(MessageEventSchema, {
          conversationId: 'channel-1',
          messageId: 'reply-1',
          senderId: 'user-2',
          body: 'thread reply',
          channelSeq: 2n,
          threadRootMessageId: 'root-1',
          threadSeq: 1n,
        }),
      },
    }))

    expect(chat.channels[0].hasUnreadThreadReplies).toBe(true)
    expect(chat.threadSummaries['root-1'].replyCount).toBe(1)
    expect(chat.threadSummaries['root-1'].lastThreadSeq).toBe(1n)
  })

  it('loads conversation history when selecting a conversation with no cached messages', async () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.sendUpdateReadCursor = vi.fn()
    chatApiMocks.listConversationMessages.mockResolvedValue({
      messages: [
        {
          id: 'message-1',
          conversation_id: 'channel-1',
          sender_id: 'user-2',
          sender_name: 'Bob',
          body: 'history',
          channel_seq: '12',
          thread_seq: '0',
          thread_root_message_id: '',
          thread_reply_count: 2,
          mention_everyone: false,
          created_at: '2026-03-06T00:00:00Z',
          reactions: [{ emoji: ':+1:', count: 2 }],
          my_reactions: [':+1:'],
        },
      ],
      has_more: false,
      page_size: 50,
      next_before_channel_seq: '',
    })

    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 3,
      lastMessageSeq: 12n,
    }]

    chat.selectChannel('channel-1')
    await Promise.resolve()

    expect(chatApiMocks.listConversationMessages).toHaveBeenCalledWith('channel-1', undefined)
    expect(chat.messages['channel-1']).toHaveLength(1)
    expect(chat.messages['channel-1'][0].body).toBe('history')
    expect(chat.messages['channel-1'][0].reactions).toEqual([{ emoji: ':+1:', count: 2 }])
    expect(chat.messages['channel-1'][0].myReactions).toEqual([':+1:'])
    expect(chat.resolveDisplayName('user-2')).toBe('Bob')
    expect(chat.threadSummaries['message-1'].replyCount).toBe(2)
    expect(chat.threadSummaries['message-1'].lastThreadSeq).toBe(2n)
  })

  it('clears initial conversation loading flag after history request resolves', async () => {
    const chat = useChatStore()
    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      lastMessageSeq: 1n,
    }]

    let resolvePage!: (value: {
      messages: Array<{
        id: string
        conversation_id: string
        sender_id: string
        sender_name: string
        body: string
        channel_seq: string
        thread_seq: string
        thread_root_message_id: string
        mention_everyone: boolean
        created_at: string
      }>
      has_more: boolean
      page_size: number
      next_before_channel_seq: string
    }) => void

    const pagePromise = new Promise<{
      messages: Array<{
        id: string
        conversation_id: string
        sender_id: string
        sender_name: string
        body: string
        channel_seq: string
        thread_seq: string
        thread_root_message_id: string
        mention_everyone: boolean
        created_at: string
      }>
      has_more: boolean
      page_size: number
      next_before_channel_seq: string
    }>((resolve) => {
      resolvePage = resolve
    })

    chatApiMocks.listConversationMessages.mockImplementation(() => pagePromise)

    const pending = chat.ensureConversationHistory('channel-1')
    expect(chat.isConversationInitialLoading('channel-1')).toBe(true)

    resolvePage({
      messages: [{
        id: 'message-1',
        conversation_id: 'channel-1',
        sender_id: 'user-2',
        sender_name: 'Bob',
        body: 'history',
        channel_seq: '1',
        thread_seq: '0',
        thread_root_message_id: '',
        mention_everyone: false,
        created_at: '2026-03-06T00:00:00Z',
      }],
      has_more: false,
      page_size: 50,
      next_before_channel_seq: '',
    })

    await pending
    expect(chat.isConversationInitialLoading('channel-1')).toBe(false)
  })

  it('loads active conversation history after bootstrap restore', async () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.setLiveSynced = vi.fn()
    ws.sendAck = vi.fn()
    chat.activeChannelId = 'channel-1'
    chatApiMocks.listConversationMessages.mockResolvedValue({
      messages: [
        {
          id: 'message-1',
          conversation_id: 'channel-1',
          sender_id: 'user-2',
          sender_name: 'Bob',
          body: 'restored history',
          channel_seq: '2',
          thread_seq: '0',
          thread_root_message_id: '',
          mention_everyone: false,
          created_at: '2026-03-06T00:00:00Z',
        },
      ],
      has_more: false,
      page_size: 50,
      next_before_channel_seq: '',
    })

    chat.handleBootstrapResponse(create(BootstrapResponseSchema, {
      snapshotSeq: 8n,
      userRole: 2,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
        selfUser: create(UserSummarySchema, { userId: 'user-1', displayName: 'Ada', avatarUrl: '' }),
        selfRole: 3,
      },
      conversations: [create(ConversationSummarySchema, {
        conversationId: 'channel-1',
        conversationType: 2,
        title: 'general',
        topic: '',
        isArchived: false,
        isMuted: false,
        lastMessageSeq: 2n,
        lastMessagePreview: 'restored history',
        memberCount: 2,
        presence: 3,
      })],
      unread: [],
      activeCalls: [],
      pendingInvites: [],
      notifications: [],
      hasMore: false,
      nextPageToken: '',
      bootstrapSessionId: 'session-1',
      pageIndex: 0,
      pageSizeEffective: 1,
      estimatedTotalConversations: 1,
      presence: [],
    }))
    await Promise.resolve()

    expect(chatApiMocks.listConversationMessages).toHaveBeenCalledWith('channel-1', undefined)
    expect(chat.messages['channel-1'][0].body).toBe('restored history')
  })

  it('loads older history with before cursor and deduplicates by message id', async () => {
    const chat = useChatStore()

    chatApiMocks.listConversationMessages
      .mockResolvedValueOnce({
        messages: [
          {
            id: 'message-2',
            conversation_id: 'channel-1',
            sender_id: 'user-2',
            sender_name: 'Bob',
            body: 'newer',
            channel_seq: '2',
            thread_seq: '0',
            thread_root_message_id: '',
            mention_everyone: false,
            created_at: '2026-03-06T00:00:01Z',
          },
          {
            id: 'message-3',
            conversation_id: 'channel-1',
            sender_id: 'user-2',
            sender_name: 'Bob',
            body: 'latest',
            channel_seq: '3',
            thread_seq: '0',
            thread_root_message_id: '',
            mention_everyone: false,
            created_at: '2026-03-06T00:00:02Z',
          },
        ],
        has_more: true,
        page_size: 2,
        next_before_channel_seq: '2',
      })
      .mockResolvedValueOnce({
        messages: [
          {
            id: 'message-1',
            conversation_id: 'channel-1',
            sender_id: 'user-2',
            sender_name: 'Bob',
            body: 'older',
            channel_seq: '1',
            thread_seq: '0',
            thread_root_message_id: '',
            mention_everyone: false,
            created_at: '2026-03-06T00:00:00Z',
          },
          {
            id: 'message-2',
            conversation_id: 'channel-1',
            sender_id: 'user-2',
            sender_name: 'Bob',
            body: 'newer duplicate',
            channel_seq: '2',
            thread_seq: '0',
            thread_root_message_id: '',
            mention_everyone: false,
            created_at: '2026-03-06T00:00:01Z',
          },
        ],
        has_more: false,
        page_size: 2,
        next_before_channel_seq: '',
      })

    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      lastMessageSeq: 3n,
    }]

    await chat.ensureConversationHistory('channel-1')
    const loaded = await chat.loadOlderConversationHistory('channel-1')

    expect(loaded).toBe(2)
    expect(chatApiMocks.listConversationMessages).toHaveBeenNthCalledWith(1, 'channel-1', undefined)
    expect(chatApiMocks.listConversationMessages).toHaveBeenNthCalledWith(2, 'channel-1', 2n)
    expect(chat.messages['channel-1'].map(item => item.id)).toEqual(['message-1', 'message-2', 'message-3'])
    expect(chat.messages['channel-1'][1].body).toBe('newer duplicate')
    expect(chat.conversationHasMoreHistory('channel-1')).toBe(false)
  })
})
