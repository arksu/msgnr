import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, shallowRef } from 'vue'
import MessageInput from '@/components/MessageInput.vue'
import RichTextComposer from '@/components/RichTextComposer.vue'
import { uploadChatAttachment } from '@/services/http/chatApi'

vi.mock('@/composables/useComposerEmojiPicker', () => ({
  useComposerEmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => {
    const showEmojiPicker = ref(false)
    return {
      showEmojiPicker,
      pickerRoot: ref(null),
      pickerToggleButton: ref(null),
      pickerComponent: shallowRef({
        template: '<button data-testid="emoji-picker-option" @click="$emit(\'select\', { native: \'🙂\' })">emoji</button>',
      }),
      emojiIndex: shallowRef({}),
      emojiPickerStyle: ref({}),
      toggleEmojiPicker: () => { showEmojiPicker.value = !showEmojiPicker.value },
      closeEmojiPicker: () => { showEmojiPicker.value = false },
      onSelectEmoji: (emoji: { native?: string; colons?: string; id?: string }) => {
        const value = emoji.native ?? emoji.colons ?? emoji.id
        if (!value) return
        onSelect(value)
        showEmojiPicker.value = false
      },
    }
  },
}))

vi.mock('@/services/http/chatApi', () => ({
  uploadChatAttachment: vi.fn(),
  deleteChatAttachment: vi.fn(),
  listMessageReactionUsers: vi.fn(),
}))

describe('MessageInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function flushAll() {
    await Promise.resolve()
    await nextTick()
  }

  async function waitForComposer(wrapper: ReturnType<typeof mount>) {
    for (let index = 0; index < 10; index += 1) {
      await flushAll()
      if (wrapper.find('.ProseMirror').exists()) return
    }
    throw new Error('composer did not mount')
  }

  function composer(wrapper: ReturnType<typeof mount>) {
    return wrapper.getComponent(RichTextComposer)
  }

  function composerEditor(wrapper: ReturnType<typeof mount>) {
    return (composer(wrapper).vm as unknown as { getEditor: () => any }).getEditor()
  }

  function prose(wrapper: ReturnType<typeof mount>) {
    return wrapper.get('.ProseMirror')
  }

  async function insertText(wrapper: ReturnType<typeof mount>, value: string) {
    ;(composer(wrapper).vm as unknown as { insertText: (text: string) => void }).insertText(value)
    await flushAll()
  }

  async function typeText(wrapper: ReturnType<typeof mount>, value: string) {
    const editor = composerEditor(wrapper)
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

  async function insertHardBreak(wrapper: ReturnType<typeof mount>) {
    await prose(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true })
    await flushAll()
  }

  it('does not emit typing=false on blur', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    await insertText(wrapper, 'hello')
    await prose(wrapper).trigger('blur')

    const typingEvents = wrapper.emitted('typing') ?? []
    expect(typingEvents).toEqual([[true]])
  })

  it('renders composer controls row below textarea', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    const editor = prose(wrapper)
    const controls = wrapper.get('[data-testid="composer-controls-row"]')
    const position = editor.element.compareDocumentPosition(controls.element)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('inserts selected emoji at cursor and closes picker', async () => {
    const wrapper = mount(MessageInput, {
      attachTo: document.body,
      props: {
        channelName: 'general',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    await insertText(wrapper, 'hello')

    await wrapper.get('[data-testid="composer-emoji-button"]').trigger('click')
    await flushAll()

    const emojiOption = document.body.querySelector('[data-testid="emoji-picker-option"]') as HTMLButtonElement | null
    expect(emojiOption).toBeTruthy()
    emojiOption?.click()
    await flushAll()

    expect(composer(wrapper).props('modelValue')).toContain('🙂')
    expect(document.body.querySelector('[data-testid="emoji-picker-option"]')).toBeNull()
  })

  it('disables emoji button when composer is disabled', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        disabled: true,
      },
    })
    await waitForComposer(wrapper)

    expect(wrapper.get('[data-testid="composer-emoji-button"]').attributes('disabled')).toBeDefined()
  })

  it('uploads dropped files from textarea as attachments', async () => {
    vi.mocked(uploadChatAttachment).mockResolvedValue({
      id: 'att-1',
      file_name: 'photo.png',
      file_size: 4,
      mime_type: 'image/png',
    })

    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        conversationId: 'channel-1',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    const file = new File(['test'], 'photo.png', { type: 'image/png' })
    await (composer(wrapper).vm as unknown as { receiveFiles: (files: File[]) => Promise<void> }).receiveFiles([file])
    await flushAll()

    expect(uploadChatAttachment).toHaveBeenCalledWith('channel-1', file, expect.any(Function))
    expect(wrapper.text()).toContain('photo.png')
  })

  it('does not upload dropped files when conversation is not selected', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    await (composer(wrapper).vm as unknown as { receiveFiles: (files: File[]) => Promise<void> }).receiveFiles([file])
    await flushAll()

    expect(uploadChatAttachment).not.toHaveBeenCalled()
  })

  it('uploads pasted clipboard file attachments', async () => {
    vi.mocked(uploadChatAttachment).mockResolvedValue({
      id: 'att-clip-1',
      file_name: 'clipboard-image.png',
      file_size: 10,
      mime_type: 'image/png',
    })

    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        conversationId: 'channel-1',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    const file = new File(['img'], 'clipboard-image.png', { type: 'image/png' })
    await (composer(wrapper).vm as unknown as { receiveFiles: (files: File[]) => Promise<void> }).receiveFiles([file])
    await flushAll()

    expect(uploadChatAttachment).toHaveBeenCalledTimes(1)
    expect(uploadChatAttachment).toHaveBeenCalledWith('channel-1', file, expect.any(Function))
    expect(wrapper.text()).toContain('clipboard-image.png')
  })

  it('shows upload progress while attachment upload is in flight', async () => {
    let finishUpload: () => void = () => {
      throw new Error('finishUpload callback was not set')
    }
    vi.mocked(uploadChatAttachment).mockImplementation((_conversationId, _file, onProgress) => (
      new Promise(resolve => {
        onProgress?.(50, 100)
        finishUpload = () => resolve({
          id: 'att-2',
          file_name: 'big.png',
          file_size: 100,
          mime_type: 'image/png',
        })
      })
    ))

    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        conversationId: 'channel-1',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    const file = new File(['test'], 'big.png', { type: 'image/png' })
    const dropPromise = (composer(wrapper).vm as unknown as { receiveFiles: (files: File[]) => Promise<void> }).receiveFiles([file])
    await flushAll()

    expect(wrapper.text()).toContain('Uploading big.png...')
    expect(wrapper.text()).toMatch(/\d{1,3}%/)

    finishUpload()
    await dropPromise
    await flushAll()

    expect(wrapper.text()).not.toContain('Uploading big.png...')
  })

  it('auto-grows textarea and caps at 8 lines', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    const editor = prose(wrapper).element as HTMLDivElement
    Object.defineProperty(editor, 'scrollHeight', {
      configurable: true,
      get: () => 400,
    })

    await insertText(wrapper, 'line')

    expect(Number.parseInt(editor.style.maxHeight, 10)).toBeGreaterThan(0)
    expect(editor.style.height).toBe(editor.style.maxHeight)
    expect(editor.style.overflowY).toBe('auto')
  })

  it('focuses the textarea when focusToken changes', async () => {
    const wrapper = mount(MessageInput, {
      attachTo: document.body,
      props: {
        channelName: 'general',
        disabled: false,
        focusToken: 0,
      },
    })
    await waitForComposer(wrapper)

    const editor = prose(wrapper).element as HTMLDivElement
    expect(document.activeElement).not.toBe(editor)

    await wrapper.setProps({ focusToken: 1 })
    await flushAll()

    expect(document.activeElement === editor || editor.contains(document.activeElement)).toBe(true)
  })

  it('supports visual-line code fence shortcuts below existing message text', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        disabled: false,
      },
    })
    await waitForComposer(wrapper)

    await insertText(wrapper, 'alpha')
    await insertHardBreak(wrapper)
    await typeText(wrapper, '```')

    const content = composerEditor(wrapper).getJSON().content ?? []
    expect(content[0]?.type).toBe('paragraph')
    expect(content[1]?.type).toBe('codeBlock')
  })
})
