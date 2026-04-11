import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { NotificationLevel } from '@/shared/proto/packets_pb'
import ThreadWorkspace from '@/components/ThreadWorkspace.vue'
import { useChatStore } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'

describe('ThreadWorkspace', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })
  })

  it('does not auto-scroll new replies when user is away from bottom', async () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.state = 'LIVE_SYNCED'
    chat.channels = [{
      id: 'channel-1',
      name: 'qa',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
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

    const wrapper = mount(ThreadWorkspace, {
      props: {
        conversationId: 'channel-1',
        rootMessageId: 'root-1',
      },
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: true,
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true })
    el.scrollTop = 900
    await wrapper.find('.overflow-y-auto').trigger('scroll')

    chat.threadMessages = {
      'root-1': [
        ...chat.threadMessages['root-1'],
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
      ],
    }

    await nextTick()

    expect(el.scrollTop).toBe(900)
  })

  it('does not force bottom on composer resize when user is away from bottom', async () => {
    const chat = useChatStore()
    const ws = useWsStore()
    ws.state = 'LIVE_SYNCED'
    chat.channels = [{
      id: 'channel-1',
      name: 'qa',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]
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

    const wrapper = mount(ThreadWorkspace, {
      props: {
        conversationId: 'channel-1',
        rootMessageId: 'root-1',
      },
      global: {
        stubs: {
          MessageBubble: true,
          MessageInput: {
            emits: ['resize'],
            template: '<button data-testid="resize" @click="$emit(\'resize\', 40)">resize</button>',
          },
        },
      },
    })

    const el = wrapper.find('.overflow-y-auto').element as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true })
    el.scrollTop = 900
    await wrapper.find('.overflow-y-auto').trigger('scroll')
    await wrapper.get('[data-testid="resize"]').trigger('click')

    expect(el.scrollTop).toBe(900)
  })
})
