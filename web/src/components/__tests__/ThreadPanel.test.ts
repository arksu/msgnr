import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import ThreadPanel from '@/components/ThreadPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'
import { NotificationLevel } from '@/shared/proto/packets_pb'

describe('ThreadPanel reaction affordance', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('disables first-reaction hover button on root and enables it for replies', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.state = 'LIVE_SYNCED'

    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chat.activeThreadConversationId = 'channel-1'
    chat.activeThreadRootId = 'root-1'
    chat.messages = {
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
    chat.threadMessages = {
      'root-1': [{
        id: 'reply-1',
        channelId: 'channel-1',
        senderId: 'user-2',
        senderName: 'Bob',
        body: 'reply',
        channelSeq: 2n,
        threadSeq: 1n,
        threadRootMessageId: 'root-1',
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: '2026-03-06T00:00:01Z',
        reactions: [],
        myReactions: [],
      }],
    }

    const wrapper = mount(ThreadPanel, {
      global: {
        stubs: {
          MessageBubble: {
            props: ['message', 'showFirstReactionAction'],
            template: '<div class="bubble-props" :data-id="message.id" :data-first-reaction="String(showFirstReactionAction)" />',
          },
          MessageInput: true,
        },
      },
    })

    const bubbles = wrapper.findAll('.bubble-props')
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0].attributes('data-id')).toBe('root-1')
    expect(bubbles[0].attributes('data-first-reaction')).toBe('false')
    expect(bubbles[1].attributes('data-id')).toBe('reply-1')
    expect(bubbles[1].attributes('data-first-reaction')).toBe('true')
  })

  it('passes the thread focus token to the thread composer', () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.state = 'LIVE_SYNCED'

    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chat.activeThreadConversationId = 'channel-1'
    chat.activeThreadRootId = 'root-1'
    chat.threadComposerFocusToken = 5
    chat.messages = {
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

    const wrapper = mount(ThreadPanel, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: {
            props: ['focusToken'],
            template: '<div data-testid="thread-focus-token">{{ focusToken }}</div>',
          },
        },
      },
    })

    expect(wrapper.get('[data-testid="thread-focus-token"]').text()).toBe('5')
  })

  it('scrolls to the latest reply when the panel opens', async () => {
    vi.useFakeTimers()

    const chat = useChatStore()
    const ws = useWsStore()
    ws.state = 'LIVE_SYNCED'

    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chat.activeThreadConversationId = 'channel-1'
    chat.activeThreadRootId = 'root-1'
    chat.messages = {
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
    chat.threadMessages = {
      'root-1': [
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
          createdAt: '2026-03-06T00:01:00Z',
          reactions: [],
          myReactions: [],
        },
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
          createdAt: '2026-03-06T00:02:00Z',
          reactions: [],
          myReactions: [],
        },
      ],
    }

    const wrapper = mount(ThreadPanel, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 2400, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true })
    el.scrollTop = 0

    await nextTick()
    vi.runAllTimers()
    await nextTick()

    expect(el.scrollTop).toBe(2400)
  })

  it('centers the focused reply instead of forcing bottom scroll on link-driven open', async () => {
    vi.useFakeTimers()

    const chat = useChatStore()
    const ws = useWsStore()
    ws.state = 'LIVE_SYNCED'

    chat.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
    chat.activeThreadConversationId = 'channel-1'
    chat.activeThreadRootId = 'root-1'
    chat.focusedThreadMessageId = 'reply-1'
    chat.messages = {
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
    chat.threadMessages = {
      'root-1': [
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
          createdAt: '2026-03-06T00:01:00Z',
          reactions: [],
          myReactions: [],
        },
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
          createdAt: '2026-03-06T00:02:00Z',
          reactions: [],
          myReactions: [],
        },
      ],
    }

    const wrapper = mount(ThreadPanel, {
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 2400, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true })
    el.scrollTop = 0

    const focusedReply = wrapper.get('[data-thread-message-id="reply-1"]').element as HTMLElement
    const scrollIntoView = vi.fn()
    Object.defineProperty(focusedReply, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    })

    await nextTick()
    vi.runAllTimers()
    await nextTick()

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(el.scrollTop).toBe(0)
  })
})
