import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, shallowRef } from 'vue'
import MessageInput from '@/components/MessageInput.vue'
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

  it('does not emit typing=false on blur', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        disabled: false,
      },
    })

    const textarea = wrapper.get('textarea')
    await textarea.setValue('hello')
    await textarea.trigger('blur')

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

    const textarea = wrapper.get('textarea')
    const controls = wrapper.get('[data-testid="composer-controls-row"]')
    const position = textarea.element.compareDocumentPosition(controls.element)
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

    const textarea = wrapper.get('textarea')
    await textarea.setValue('hello')
    const el = textarea.element as HTMLTextAreaElement
    el.focus()
    el.setSelectionRange(2, 2)

    await wrapper.get('[data-testid="composer-emoji-button"]').trigger('click')
    await flushAll()

    const emojiOption = document.body.querySelector('[data-testid="emoji-picker-option"]') as HTMLButtonElement | null
    expect(emojiOption).toBeTruthy()
    emojiOption?.click()
    await flushAll()

    expect((textarea.element as HTMLTextAreaElement).value).toBe('he🙂llo')
    expect(document.body.querySelector('[data-testid="emoji-picker-option"]')).toBeNull()
  })

  it('disables emoji button when composer is disabled', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        channelName: 'general',
        disabled: true,
      },
    })

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

    const file = new File(['test'], 'photo.png', { type: 'image/png' })
    await wrapper.get('textarea').trigger('drop', {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    })

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

    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    await wrapper.get('textarea').trigger('drop', {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    })

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

    const file = new File(['img'], 'clipboard-image.png', { type: 'image/png' })
    await wrapper.get('textarea').trigger('paste', {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => file }],
        files: [file],
      },
    })

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

    const file = new File(['test'], 'big.png', { type: 'image/png' })
    const dropPromise = wrapper.get('textarea').trigger('drop', {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    })
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

    const textarea = wrapper.get('textarea').element as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => 400,
    })

    await wrapper.get('textarea').setValue('line')

    expect(Number.parseInt(textarea.style.maxHeight, 10)).toBeGreaterThan(0)
    expect(textarea.style.height).toBe(textarea.style.maxHeight)
    expect(textarea.style.overflowY).toBe('auto')
  })
})
