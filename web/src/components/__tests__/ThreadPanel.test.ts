import { describe, expect, it, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ThreadPanel from '@/components/ThreadPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'
import { NotificationLevel } from '@/shared/proto/packets_pb'

describe('ThreadPanel reaction affordance', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
})
