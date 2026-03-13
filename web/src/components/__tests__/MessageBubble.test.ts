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
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
}))

vi.mock('@/services/http/chatApi', () => ({
  fetchMessageAttachmentBlob: chatApiMocks.fetchMessageAttachmentBlob,
  listMessageReactionUsers: chatApiMocks.listMessageReactionUsers,
  editMessage: chatApiMocks.editMessage,
  deleteMessage: chatApiMocks.deleteMessage,
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
    chatApiMocks.editMessage.mockReset()
    chatApiMocks.editMessage.mockResolvedValue({
      message_id: 'message-1',
      edited_at: '2026-03-06T00:10:00Z',
    })
    chatApiMocks.deleteMessage.mockReset()
    chatApiMocks.deleteMessage.mockResolvedValue(undefined)
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

  it('shows edit/delete menu items only for own confirmed messages', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const ownConfirmed = buildMessage({ senderId: 'user-1', reactions: [], myReactions: [] })
    const ownWrapper = mount(MessageBubble, {
      props: { message: ownConfirmed, showHeader: true },
      attachTo: document.body,
    })
    await ownWrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    expect(document.body.querySelector('[data-testid="message-menu-edit"]')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="message-menu-delete"]')).toBeTruthy()
    ownWrapper.unmount()

    const otherMessage = buildMessage({ senderId: 'user-2', reactions: [], myReactions: [] })
    const otherWrapper = mount(MessageBubble, {
      props: { message: otherMessage, showHeader: true },
      attachTo: document.body,
    })
    await otherWrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    expect(document.body.querySelector('[data-testid="message-menu-edit"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="message-menu-delete"]')).toBeNull()
    otherWrapper.unmount()

    const ownUnconfirmed = buildMessage({
      senderId: 'user-1',
      sendStatus: 'sending',
      reactions: [],
      myReactions: [],
    })
    const pendingWrapper = mount(MessageBubble, {
      props: { message: ownUnconfirmed, showHeader: true },
      attachTo: document.body,
    })
    await pendingWrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    expect(document.body.querySelector('[data-testid="message-menu-edit"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="message-menu-delete"]')).toBeNull()
    pendingWrapper.unmount()
  })

  it('edits inline and renders edited marker', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const msg = buildMessage({
      senderId: 'user-1',
      reactions: [],
      myReactions: [],
      body: 'before edit',
    })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await wrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    const editMenu = document.body.querySelector('[data-testid="message-menu-edit"]') as HTMLButtonElement
    expect(editMenu).toBeTruthy()
    editMenu.click()
    await flushAll()

    const textarea = wrapper.get('[data-testid="message-edit-textarea"]')
    expect(wrapper.find('[data-testid="message-edit-save"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="message-edit-cancel"]').exists()).toBe(false)
    await textarea.setValue('edited body')
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushAll()

    expect(chatApiMocks.editMessage).toHaveBeenCalledWith('message-1', 'edited body')
    expect(msg.body).toBe('edited body')
    expect(msg.editedAt).toBe('2026-03-06T00:10:00Z')
    expect(wrapper.find('[data-testid="message-edited-marker"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('uses Shift+Enter for newline and Enter for submit while editing', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const msg = buildMessage({
      senderId: 'user-1',
      reactions: [],
      myReactions: [],
      body: 'start',
    })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await wrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    const editMenu = document.body.querySelector('[data-testid="message-menu-edit"]') as HTMLButtonElement
    editMenu.click()
    await flushAll()

    const textarea = wrapper.get('[data-testid="message-edit-textarea"]')
    await textarea.setValue('line 1')
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })
    await flushAll()
    expect(chatApiMocks.editMessage).not.toHaveBeenCalled()

    await textarea.setValue('line 1\nline 2')
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushAll()

    expect(chatApiMocks.editMessage).toHaveBeenCalledWith('message-1', 'line 1\nline 2')
    wrapper.unmount()
  })

  it('deletes message via API and applies local removal on success', async () => {
    const auth = useAuthStore()
    const chat = useChatStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }
    const applyLocalDeleteSpy = vi.spyOn(chat, 'applyLocalMessageDeleted')

    const msg = buildMessage({
      senderId: 'user-1',
      reactions: [],
      myReactions: [],
    })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await wrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    const deleteMenu = document.body.querySelector('[data-testid="message-menu-delete"]') as HTMLButtonElement
    expect(deleteMenu).toBeTruthy()
    deleteMenu.click()
    await flushAll()

    expect(chatApiMocks.deleteMessage).toHaveBeenCalledWith('message-1')
    expect(applyLocalDeleteSpy).toHaveBeenCalledWith('channel-1', 'message-1', undefined)
    wrapper.unmount()
  })

  it('cancels inline edit when Escape is pressed', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const msg = buildMessage({
      senderId: 'user-1',
      reactions: [],
      myReactions: [],
      body: 'before',
    })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await wrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    const editMenu = document.body.querySelector('[data-testid="message-menu-edit"]') as HTMLButtonElement
    editMenu.click()
    await flushAll()
    expect(wrapper.find('[data-testid="message-edit-textarea"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushAll()

    expect(wrapper.find('[data-testid="message-edit-textarea"]').exists()).toBe(false)
    expect(msg.body).toBe('before')
    wrapper.unmount()
  })

  it('renders compact image thumbnail and restrained lightbox contract, and closes on Escape', async () => {
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

    const thumbnailButton = wrapper.get('[data-testid="message-image-thumbnail"]')
    expect(thumbnailButton.classes()).toContain('max-w-[180px]')
    expect(thumbnailButton.classes()).toContain('sm:max-w-[280px]')
    expect(thumbnailButton.classes()).toContain('cursor-pointer')

    const thumbnailImage = wrapper.get('[data-testid="message-image-thumbnail-img"]')
    expect(thumbnailImage.classes()).toContain('max-h-[180px]')
    expect(thumbnailImage.classes()).toContain('sm:max-h-[220px]')
    expect(thumbnailImage.classes()).toContain('object-contain')
    expect(thumbnailImage.classes()).not.toContain('object-cover')

    await thumbnailButton.trigger('click')
    await flushAll()

    const lightbox = document.body.querySelector('[data-testid="message-image-lightbox"]')
    expect(lightbox).toBeTruthy()
    const lightboxImage = document.body.querySelector('[data-testid="message-image-lightbox-img"]')
    expect(lightboxImage).toBeTruthy()
    expect(lightboxImage?.classList.contains('max-h-[60vh]')).toBe(true)
    expect(lightboxImage?.classList.contains('sm:max-h-[70vh]')).toBe(true)
    expect(lightboxImage?.classList.contains('max-w-[86vw]')).toBe(true)
    expect(lightboxImage?.classList.contains('sm:max-w-[74vw]')).toBe(true)
    expect(lightboxImage?.classList.contains('max-h-[85vh]')).toBe(false)
    expect(lightboxImage?.classList.contains('max-w-[90vw]')).toBe(false)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushAll()

    expect(document.body.querySelector('[data-testid="message-image-lightbox"]')).toBeNull()

    wrapper.unmount()
  })

  it('closes image preview on close button and backdrop click', async () => {
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

    await wrapper.get('[data-testid="message-image-thumbnail"]').trigger('click')
    await flushAll()

    const closeButton = document.body.querySelector('[data-testid="message-image-lightbox-close"]') as HTMLButtonElement
    expect(closeButton).toBeTruthy()
    closeButton.click()
    await flushAll()
    expect(document.body.querySelector('[data-testid="message-image-lightbox"]')).toBeNull()

    await wrapper.get('[data-testid="message-image-thumbnail"]').trigger('click')
    await flushAll()

    const lightbox = document.body.querySelector('[data-testid="message-image-lightbox"]') as HTMLDivElement
    expect(lightbox).toBeTruthy()
    lightbox.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushAll()
    expect(document.body.querySelector('[data-testid="message-image-lightbox"]')).toBeNull()

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
