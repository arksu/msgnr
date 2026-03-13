import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import MessageBubble from '@/components/MessageBubble.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore, type Message } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'

const chatApiMocks = vi.hoisted(() => ({
  fetchMessageAttachmentBlob: vi.fn(),
  listMessageReactionUsers: vi.fn(),
}))

vi.mock('@/services/http/chatApi', () => ({
  fetchMessageAttachmentBlob: chatApiMocks.fetchMessageAttachmentBlob,
  listMessageReactionUsers: chatApiMocks.listMessageReactionUsers,
}))

async function flushAll() {
  await Promise.resolve()
  await nextTick()
}

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
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
    reactions: [{ emoji: ':+1:', count: 1 }],
    myReactions: [],
    ...overrides,
  }
}

describe('MessageBubble reactions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    chatApiMocks.fetchMessageAttachmentBlob.mockResolvedValue(new Blob(['img'], { type: 'image/png' }))
    chatApiMocks.listMessageReactionUsers.mockReset()
    chatApiMocks.listMessageReactionUsers.mockResolvedValue([])
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:attachment-preview')
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clicking own reaction sends remove', async () => {
    const auth = useAuthStore()
    const chat = useChatStore()
    const ws = useWsStore()

    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }
    const msg = buildMessage({ myReactions: [':+1:'] })
    chat.messages = { 'channel-1': [msg] }
    ws.sendRemoveReaction = vi.fn()
    ws.sendAddReaction = vi.fn()
    chat.queueReactionOp = vi.fn()

    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
    })

    await wrapper.findAll('button').find(button => button.text().includes(':+1:'))?.trigger('click')

    expect(ws.sendRemoveReaction).toHaveBeenCalledWith('channel-1', 'message-1', ':+1:', expect.any(String))
    expect(chat.queueReactionOp).toHaveBeenCalledWith(expect.any(String), 'channel-1', 'message-1', ':+1:', 'remove')
    expect(ws.sendAddReaction).not.toHaveBeenCalled()
  })

  it('clicking others reaction sends add', async () => {
    const auth = useAuthStore()
    const chat = useChatStore()
    const ws = useWsStore()

    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }
    const msg = buildMessage({ myReactions: [] })
    chat.messages = { 'channel-1': [msg] }
    ws.sendRemoveReaction = vi.fn()
    ws.sendAddReaction = vi.fn()
    chat.queueReactionOp = vi.fn()

    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
    })

    await wrapper.findAll('button').find(button => button.text().includes(':+1:'))?.trigger('click')

    expect(ws.sendAddReaction).toHaveBeenCalledWith('channel-1', 'message-1', ':+1:', expect.any(String))
    expect(chat.queueReactionOp).toHaveBeenCalledWith(expect.any(String), 'channel-1', 'message-1', ':+1:', 'add')
    expect(ws.sendRemoveReaction).not.toHaveBeenCalled()
  })

  it('uses workspace self identity fallback when auth user is not hydrated', async () => {
    const auth = useAuthStore()
    const chat = useChatStore()
    const ws = useWsStore()

    auth.user = null
    chat.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'U1',
      selfRole: 'member',
    }
    const msg = buildMessage({ myReactions: [] })
    chat.messages = { 'channel-1': [msg] }
    ws.sendRemoveReaction = vi.fn()
    ws.sendAddReaction = vi.fn()
    chat.queueReactionOp = vi.fn()

    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
    })

    await wrapper.findAll('button').find(button => button.text().includes(':+1:'))?.trigger('click')

    expect(ws.sendAddReaction).toHaveBeenCalledWith('channel-1', 'message-1', ':+1:', expect.any(String))
    expect(chat.queueReactionOp).toHaveBeenCalledWith(expect.any(String), 'channel-1', 'message-1', ':+1:', 'add')
  })

  it('shows New thread button for a root message and emits openThread on click', async () => {
    const msg = buildMessage({ reactions: [], myReactions: [] })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true, threadReplyCount: 0 },
    })

    const button = wrapper.get('[data-testid="new-thread-button"]')
    expect(button).toBeTruthy()

    await button.trigger('click')
    const emitted = wrapper.emitted('openThread')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toEqual(msg)
  })

  it('shows View thread when replies already exist', () => {
    const msg = buildMessage({ reactions: [], myReactions: [] })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true, threadReplyCount: 3 },
    })

    const button = wrapper.get('[data-testid="thread-action-button"]')
    expect(button.text()).toContain('3 replies')
  })

  it('hides thread action for thread replies but keeps it for self-root encoded messages', () => {
    const reply = buildMessage({ id: 'reply-1', threadRootMessageId: 'root-1', reactions: [], myReactions: [] })
    const replyWrapper = mount(MessageBubble, {
      props: { message: reply, showHeader: true },
    })
    expect(replyWrapper.find('[data-testid="thread-action-button"]').exists()).toBe(false)
    expect(replyWrapper.find('[data-testid="new-thread-button"]').exists()).toBe(false)

    const selfRoot = buildMessage({ id: 'root-2', threadRootMessageId: 'root-2', reactions: [], myReactions: [] })
    const selfRootWrapper = mount(MessageBubble, {
      props: { message: selfRoot, showHeader: true },
    })
    expect(selfRootWrapper.find('[data-testid="new-thread-button"]').exists()).toBe(true)
  })

  it('shows message header timestamp with date and time', () => {
    const createdAt = '2026-03-06T13:05:00Z'
    const msg = buildMessage({ reactions: [], myReactions: [], createdAt })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
    })

    const expected = new Date(createdAt).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    expect(wrapper.text()).toContain(expected)
  })

  it('closes image preview when Escape is pressed', async () => {
    const msg = buildMessage({
      reactions: [],
      myReactions: [],
      attachments: [{
        id: 'att-1',
        fileName: 'photo.png',
        fileSize: 3,
        mimeType: 'image/png',
      }],
    })

    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await flushAll()

    const previewImage = wrapper.find('img[alt="photo.png"]')
    expect(previewImage.exists()).toBe(true)
    await previewImage.trigger('click')
    await flushAll()

    const beforeEscCount = document.body.querySelectorAll('img[alt="photo.png"]').length
    expect(beforeEscCount).toBe(2)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushAll()

    const afterEscCount = document.body.querySelectorAll('img[alt="photo.png"]').length
    expect(afterEscCount).toBe(1)

    wrapper.unmount()
  })

  it('shows reaction users popup on hover and keeps it open when moving pointer into popup', async () => {
    vi.useFakeTimers()
    chatApiMocks.listMessageReactionUsers.mockResolvedValue([
      { user_id: 'user-1', display_name: 'Alice', avatar_url: '/api/public/avatars/alice.png' },
      { user_id: 'user-2', display_name: 'Bob', avatar_url: '' },
    ])

    const msg = buildMessage()
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    const reactionButton = wrapper.findAll('button').find(button => button.text().includes(':+1:'))
    expect(reactionButton).toBeTruthy()
    await reactionButton!.trigger('mouseenter')
    await flushAll()

    expect(chatApiMocks.listMessageReactionUsers).toHaveBeenCalledWith('channel-1', 'message-1', ':+1:')
    expect(document.body.querySelector('[data-testid="reaction-users-popup"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Alice')

    await reactionButton!.trigger('mouseleave')
    const popup = document.body.querySelector('[data-testid="reaction-users-popup"]')
    expect(popup).toBeTruthy()
    popup!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    vi.advanceTimersByTime(200)
    await flushAll()
    expect(document.body.querySelector('[data-testid="reaction-users-popup"]')).toBeTruthy()

    popup!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    vi.advanceTimersByTime(200)
    await flushAll()
    expect(document.body.querySelector('[data-testid="reaction-users-popup"]')).toBeNull()

    wrapper.unmount()
  })

  it('reuses cached reaction users and invalidates cache when count changes', async () => {
    vi.useFakeTimers()
    chatApiMocks.listMessageReactionUsers.mockResolvedValue([
      { user_id: 'user-1', display_name: 'Alice', avatar_url: '' },
    ])

    const msg = buildMessage()
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    let reactionButton = wrapper.findAll('button').find(button => button.text().includes(':+1:'))
    expect(reactionButton).toBeTruthy()

    await reactionButton!.trigger('mouseenter')
    await flushAll()
    expect(chatApiMocks.listMessageReactionUsers).toHaveBeenCalledTimes(1)

    await reactionButton!.trigger('mouseleave')
    vi.advanceTimersByTime(200)
    await flushAll()

    reactionButton = wrapper.findAll('button').find(button => button.text().includes(':+1:'))
    await reactionButton!.trigger('mouseenter')
    await flushAll()
    expect(chatApiMocks.listMessageReactionUsers).toHaveBeenCalledTimes(1)

    await wrapper.setProps({
      message: {
        ...msg,
        reactions: [{ emoji: ':+1:', count: 2 }],
      },
    })
    await flushAll()
    await reactionButton!.trigger('mouseleave')
    vi.advanceTimersByTime(200)
    await flushAll()

    reactionButton = wrapper.findAll('button').find(button => button.text().includes(':+1:'))
    await reactionButton!.trigger('mouseenter')
    await flushAll()
    expect(chatApiMocks.listMessageReactionUsers).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it('renders loading and error states for reaction users popup', async () => {
    vi.useFakeTimers()
    let resolveUsers!: (value: Array<{ user_id: string; display_name: string; avatar_url: string }>) => void
    chatApiMocks.listMessageReactionUsers.mockImplementationOnce(() => new Promise(resolve => {
      resolveUsers = resolve
    }))

    const msg = buildMessage()
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    const reactionButton = wrapper.findAll('button').find(button => button.text().includes(':+1:'))
    expect(reactionButton).toBeTruthy()
    await reactionButton!.trigger('mouseenter')
    await nextTick()

    expect(document.body.querySelector('[data-testid="reaction-users-loading"]')).toBeTruthy()

    resolveUsers([{ user_id: 'user-1', display_name: 'Alice', avatar_url: '' }])
    await flushAll()
    expect(document.body.textContent).toContain('Alice')

    await reactionButton!.trigger('mouseleave')
    vi.advanceTimersByTime(200)
    await flushAll()

    chatApiMocks.listMessageReactionUsers.mockRejectedValueOnce(new Error('boom'))
    await wrapper.setProps({
      message: {
        ...msg,
        reactions: [{ emoji: ':+1:', count: 2 }],
      },
    })
    await flushAll()

    await reactionButton!.trigger('mouseenter')
    await flushAll()
    const errorNode = document.body.querySelector('[data-testid="reaction-users-error"]')
    expect(errorNode).toBeTruthy()
    expect(errorNode?.textContent).toContain('Failed to load reactions')

    wrapper.unmount()
  })
})
