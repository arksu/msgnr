import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageInput from '@/components/MessageInput.vue'
import { uploadChatAttachment } from '@/services/http/chatApi'

vi.mock('@/services/http/chatApi', () => ({
  uploadChatAttachment: vi.fn(),
  deleteChatAttachment: vi.fn(),
}))

describe('MessageInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    expect(uploadChatAttachment).toHaveBeenCalledWith('channel-1', file)
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
})
