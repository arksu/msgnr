import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import MessageBubble from '@/components/MessageBubble.vue'
import RichTextComposer from '@/components/RichTextComposer.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore, type Message } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'

const chatApiMocks = vi.hoisted(() => ({
  createOrOpenDm: vi.fn(),
  fetchMessageAttachmentBlob: vi.fn(),
  listMessageReactionUsers: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  listSavedMessages: vi.fn(),
  saveMessage: vi.fn(),
  unsaveMessage: vi.fn(),
}))

vi.mock('@/services/http/chatApi', () => ({
  createOrOpenDm: chatApiMocks.createOrOpenDm,
  fetchMessageAttachmentBlob: chatApiMocks.fetchMessageAttachmentBlob,
  listMessageReactionUsers: chatApiMocks.listMessageReactionUsers,
  editMessage: chatApiMocks.editMessage,
  deleteMessage: chatApiMocks.deleteMessage,
  listSavedMessages: chatApiMocks.listSavedMessages,
  saveMessage: chatApiMocks.saveMessage,
  unsaveMessage: chatApiMocks.unsaveMessage,
}))

async function flushAll() {
  await Promise.resolve()
  await nextTick()
}

async function waitForEditComposer(wrapper: ReturnType<typeof mount>) {
  for (let index = 0; index < 10; index += 1) {
    await flushAll()
    if (wrapper.find('[data-testid="message-edit-textarea"] .ProseMirror').exists()) return
  }
  throw new Error('edit composer did not mount')
}

function editComposer(wrapper: ReturnType<typeof mount>) {
  return wrapper.getComponent(RichTextComposer)
}

function editEditor(wrapper: ReturnType<typeof mount>) {
  return (editComposer(wrapper).vm as unknown as { getEditor: () => any }).getEditor()
}

function editProse(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('[data-testid="message-edit-textarea"] .ProseMirror')
}

async function insertEditText(wrapper: ReturnType<typeof mount>, value: string) {
  ;(editComposer(wrapper).vm as unknown as { setValue: (text: string) => void }).setValue(value)
  await flushAll()
}

async function appendEditText(wrapper: ReturnType<typeof mount>, value: string) {
  ;(editComposer(wrapper).vm as unknown as { insertText: (text: string) => void }).insertText(value)
  await flushAll()
}

async function typeEditText(wrapper: ReturnType<typeof mount>, value: string) {
  const editor = editEditor(wrapper)
  const view = editor.view

  for (const char of value) {
    const from = view.state.selection.from
    const to = view.state.selection.to
    let handled = false
    view.someProp('handleTextInput', (handler: (view: any, from: number, to: number, text: string) => boolean) => {
      handled = handler(view, from, to, char)
      return handled
    })
    if (!handled) {
      view.dispatch(view.state.tr.insertText(char, from, to))
    }
  }

  await flushAll()
}

async function insertEditHardBreak(wrapper: ReturnType<typeof mount>) {
  await editProse(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true })
  await flushAll()
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
    chatApiMocks.createOrOpenDm.mockReset()
    chatApiMocks.createOrOpenDm.mockResolvedValue({
      conversation_id: 'dm-1',
      user_id: 'user-3',
      display_name: 'Alice Example',
      email: 'alice@example.com',
      avatar_url: 'https://example.com/alice.png',
      kind: 'dm',
      visibility: 'dm',
    })
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
    chatApiMocks.listSavedMessages.mockReset()
    chatApiMocks.listSavedMessages.mockResolvedValue({ total_count: 0, items: [] })
    chatApiMocks.saveMessage.mockReset()
    chatApiMocks.saveMessage.mockResolvedValue(undefined)
    chatApiMocks.unsaveMessage.mockReset()
    chatApiMocks.unsaveMessage.mockResolvedValue(undefined)
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:attachment-preview')
    globalThis.URL.revokeObjectURL = vi.fn()
    window.open = vi.fn(() => ({
      opener: null,
      focus: vi.fn(),
      close: vi.fn(),
    } as unknown as Window))
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

  it('shows save action for any confirmed message and toggles saved state', async () => {
    const chat = useChatStore()
    const msg = buildMessage({ senderId: 'other-user', reactions: [], myReactions: [], isSaved: false })
    chat.messages = { 'channel-1': [msg] }
    chat.bootstrapped = true

    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
    })

    await wrapper.get('[data-testid="save-message-button"]').trigger('click')
    await flushAll()

    expect(chatApiMocks.saveMessage).toHaveBeenCalledWith('message-1')
    expect(chat.messages['channel-1'][0].isSaved).toBe(true)
  })

  it('hides save action for queued messages', () => {
    const msg = buildMessage({ reactions: [], myReactions: [], sendStatus: 'queued' })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
    })

    expect(wrapper.find('[data-testid="save-message-button"]').exists()).toBe(false)
  })

  it('hides thread action for thread replies but keeps it for self-root encoded messages', () => {
    const reply = buildMessage({ id: 'reply-1', threadRootMessageId: 'root-1', reactions: [], myReactions: [] })
    const replyWrapper = mount(MessageBubble, {
      props: { message: reply, showHeader: true },
    })
    expect(replyWrapper.find('[data-testid="thread-action-button"]').exists()).toBe(false)
    expect(replyWrapper.find('[data-testid="new-thread-button"]').exists()).toBe(false)
    expect(replyWrapper.find('[data-testid="first-reaction-button"]').exists()).toBe(false)

    const selfRoot = buildMessage({ id: 'root-2', threadRootMessageId: 'root-2', reactions: [], myReactions: [] })
    const selfRootWrapper = mount(MessageBubble, {
      props: { message: selfRoot, showHeader: true },
    })
    expect(selfRootWrapper.find('[data-testid="new-thread-button"]').exists()).toBe(true)
  })

  it('shows first-reaction hover button for thread replies when explicitly enabled', () => {
    const reply = buildMessage({ id: 'reply-1', threadRootMessageId: 'root-1', reactions: [], myReactions: [] })
    const wrapper = mount(MessageBubble, {
      props: {
        message: reply,
        showHeader: true,
        showThreadAction: false,
        showFirstReactionAction: true,
      },
    })

    expect(wrapper.find('[data-testid="first-reaction-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="thread-action-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="new-thread-button"]').exists()).toBe(false)
  })

  it('keeps first-reaction hover button hidden when explicitly disabled', () => {
    const msg = buildMessage({ reactions: [], myReactions: [] })
    const wrapper = mount(MessageBubble, {
      props: {
        message: msg,
        showHeader: true,
        showFirstReactionAction: false,
      },
    })

    expect(wrapper.find('[data-testid="first-reaction-button"]').exists()).toBe(false)
  })

  it('keeps first-reaction hover button visible for main chat messages by default', () => {
    const msg = buildMessage({ reactions: [], myReactions: [] })
    const wrapper = mount(MessageBubble, {
      props: {
        message: msg,
        showHeader: true,
      },
    })

    expect(wrapper.find('[data-testid="first-reaction-button"]').exists()).toBe(true)
  })

  it('keeps existing reactions add button when reactions already exist', () => {
    const msg = buildMessage()
    const wrapper = mount(MessageBubble, {
      props: {
        message: msg,
        showHeader: true,
        showFirstReactionAction: false,
      },
    })

    const addReactionButtons = wrapper.findAll('button[title="Add reaction"]')
    expect(addReactionButtons).toHaveLength(1)
    expect(addReactionButtons[0].text()).toContain('+')
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

  it('opens inline edit when editRequestToken changes for an own confirmed message', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const msg = buildMessage({
      senderId: 'user-1',
      reactions: [],
      myReactions: [],
      body: 'before edit',
    })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true, editRequestToken: 0 },
      attachTo: document.body,
    })

    await wrapper.setProps({ editRequestToken: 1 })
    await waitForEditComposer(wrapper)

    expect(wrapper.find('[data-testid="message-edit-textarea"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('ignores editRequestToken for messages that cannot be edited', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const otherMessage = mount(MessageBubble, {
      props: {
        message: buildMessage({ senderId: 'user-2', reactions: [], myReactions: [] }),
        showHeader: true,
        editRequestToken: 0,
      },
      attachTo: document.body,
    })
    await otherMessage.setProps({ editRequestToken: 1 })
    await flushAll()
    expect(otherMessage.find('[data-testid="message-edit-textarea"]').exists()).toBe(false)
    otherMessage.unmount()

    const unconfirmedMessage = mount(MessageBubble, {
      props: {
        message: buildMessage({ senderId: 'user-1', sendStatus: 'sending', reactions: [], myReactions: [] }),
        showHeader: true,
        editRequestToken: 0,
      },
      attachTo: document.body,
    })
    await unconfirmedMessage.setProps({ editRequestToken: 1 })
    await flushAll()
    expect(unconfirmedMessage.find('[data-testid="message-edit-textarea"]').exists()).toBe(false)
    unconfirmedMessage.unmount()
  })

  it('edits inline and renders edited marker', async () => {
    const auth = useAuthStore()
    const chat = useChatStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const msg = buildMessage({
      senderId: 'user-1',
      reactions: [],
      myReactions: [],
      body: 'before edit',
    })
    chat.messages = { 'channel-1': [msg] }
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await wrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    const editMenu = document.body.querySelector('[data-testid="message-menu-edit"]') as HTMLButtonElement
    expect(editMenu).toBeTruthy()
    editMenu.click()
    await waitForEditComposer(wrapper)

    const editor = editProse(wrapper)
    expect(wrapper.find('[data-testid="message-edit-save"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="message-edit-cancel"]').exists()).toBe(false)
    await insertEditText(wrapper, 'edited body')
    await editor.trigger('keydown', { key: 'Enter' })
    await flushAll()

    expect(chatApiMocks.editMessage).toHaveBeenCalledWith('message-1', 'edited body', [])
    expect(chat.messages['channel-1'][0].body).toBe('edited body')
    expect(chat.messages['channel-1'][0].editedAt).toBe('2026-03-06T00:10:00.000Z')
    expect(wrapper.find('[data-testid="message-edited-marker"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('sizes inline edit composer to its content on open', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const msg = buildMessage({
      senderId: 'user-1',
      reactions: [],
      myReactions: [],
      body: 'line 1\nline 2\nline 3\nline 4\nline 5',
    })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await wrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    const editMenu = document.body.querySelector('[data-testid="message-menu-edit"]') as HTMLButtonElement
    editMenu.click()
    await waitForEditComposer(wrapper)

    const editor = editProse(wrapper).element as HTMLDivElement
    Object.defineProperty(editor, 'scrollHeight', {
      configurable: true,
      get: () => 240,
    })

    await insertEditText(wrapper, '\nextra')
    await flushAll()

    expect(editor.style.maxHeight).toBe('')
    expect(editor.style.height).toBe('240px')
    expect(editor.style.overflowY).toBe('hidden')
    wrapper.unmount()
  })

  it('keeps inline edit composer synced with content growth', async () => {
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
    await waitForEditComposer(wrapper)

    const editor = editProse(wrapper).element as HTMLDivElement
    let scrollHeight = 96
    Object.defineProperty(editor, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })

    await insertEditText(wrapper, 'line 1')
    expect(editor.style.height).toBe('96px')

    scrollHeight = 232
    await insertEditText(wrapper, '\nline 2\nline 3\nline 4')
    expect(editor.style.height).toBe('232px')
    expect(editor.style.overflowY).toBe('hidden')
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
    await waitForEditComposer(wrapper)

    const editor = editProse(wrapper)
    await insertEditText(wrapper, 'line 1')
    await editor.trigger('keydown', { key: 'Enter', shiftKey: true })
    await flushAll()
    expect(chatApiMocks.editMessage).not.toHaveBeenCalled()

    await appendEditText(wrapper, 'line 2')
    await editor.trigger('keydown', { key: 'Enter' })
    await flushAll()

    expect(chatApiMocks.editMessage).toHaveBeenCalledWith('message-1', 'line 1\nline 2', [])
    wrapper.unmount()
  })

  it('supports visual-line list shortcuts while editing inline', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-1', email: 'u1@example.com', displayName: 'U1', role: 'member' }

    const msg = buildMessage({
      senderId: 'user-1',
      reactions: [],
      myReactions: [],
      body: 'alpha',
    })
    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await wrapper.get('button[title="More actions"]').trigger('click')
    await flushAll()
    const editMenu = document.body.querySelector('[data-testid="message-menu-edit"]') as HTMLButtonElement
    editMenu.click()
    await waitForEditComposer(wrapper)

    await insertEditText(wrapper, 'alpha')
    await insertEditHardBreak(wrapper)
    await typeEditText(wrapper, '1. ')

    const content = editEditor(wrapper).getJSON().content ?? []
    expect(content[0]?.type).toBe('paragraph')
    expect(content[1]?.type).toBe('orderedList')
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
    await waitForEditComposer(wrapper)
    expect(wrapper.find('[data-testid="message-edit-textarea"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushAll()

    expect(wrapper.find('[data-testid="message-edit-textarea"]').exists()).toBe(false)
    expect(msg.body).toBe('before')
    wrapper.unmount()
  })

  it('opens markdown links from the rendered message body', async () => {
    const msg = buildMessage({
      reactions: [],
      myReactions: [],
      body: '[OpenAI](https://openai.com)',
    })

    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await flushAll()

    const link = wrapper.get('.markdown-body a')
    link.element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }))
    await flushAll()

    expect(window.open).toHaveBeenCalledWith('https://openai.com/', '_blank')

    wrapper.unmount()
  })

  it('opens a direct message when clicking a user mention in the rendered message body', async () => {
    const chat = useChatStore()
    const openDirectMessageSpy = vi.spyOn(chat, 'openDirectMessage').mockImplementation(() => {})
    const msg = buildMessage({
      reactions: [],
      myReactions: [],
      body: '@Alice Example hi',
      entities: [{
        kind: 'user',
        targetId: 'user-3',
        label: '@Alice Example',
        href: '',
        start: 0,
        end: 14,
      }],
    })

    const wrapper = mount(MessageBubble, {
      props: { message: msg, showHeader: true },
      attachTo: document.body,
    })

    await flushAll()

    await wrapper.get('[data-message-entity-kind="user"]').trigger('click')
    await flushAll()

    expect(chatApiMocks.createOrOpenDm).toHaveBeenCalledWith('user-3')
    expect(openDirectMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dm-1',
      userId: 'user-3',
      displayName: 'Alice Example',
    }))

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
