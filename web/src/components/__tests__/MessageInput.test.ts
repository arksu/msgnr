import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MessageInput from '@/components/MessageInput.vue'
import { uploadChatAttachment } from '@/services/http/chatApi'

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
    expect(wrapper.text()).toContain('50%')

    finishUpload()
    await dropPromise
    await flushAll()

    expect(wrapper.text()).not.toContain('Uploading big.png...')
  })
})
