import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AttachmentMarkdownContent from '@/components/AttachmentMarkdownContent.vue'
import { fetchOwnedAttachmentBlob } from '@/services/http/attachmentOwnersApi'

vi.mock('@/services/http/attachmentOwnersApi', () => ({
  fetchOwnedAttachmentBlob: vi.fn(),
}))

describe('AttachmentMarkdownContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:attachment')
    globalThis.URL.revokeObjectURL = vi.fn()
    window.open = vi.fn(() => ({
      location: {
        replace: vi.fn(),
      },
      close: vi.fn(),
    } as unknown as Window))
    vi.mocked(fetchOwnedAttachmentBlob).mockResolvedValue(new Blob(['blob'], { type: 'application/octet-stream' }))
  })

  it('renders image tokens with fetched previews and opens file tokens in a new tab', async () => {
    const wrapper = mount(AttachmentMarkdownContent, {
      props: {
        markdown: [
          '![Photo](msgnr-attachment://task/task-1/att-1)',
          '',
          '[Spec.pdf](msgnr-attachment://document/doc-1/att-2)',
        ].join('\n'),
      },
    })

    await flushPromises()

    expect(fetchOwnedAttachmentBlob).toHaveBeenCalledWith('task', 'task-1', 'att-1')
    expect(wrapper.get('[data-testid="attachment-markdown-image-img"]').attributes('src')).toBe('blob:attachment')

    await wrapper.get('[data-testid="attachment-markdown-file-link"]').trigger('click')
    await flushPromises()

    expect(fetchOwnedAttachmentBlob).toHaveBeenCalledWith('document', 'doc-1', 'att-2')
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank')
    const opened = vi.mocked(window.open).mock.results[0]?.value as { location: { replace: ReturnType<typeof vi.fn> } }
    expect(opened.location.replace).toHaveBeenCalledWith('blob:attachment')
    vi.advanceTimersByTime(1_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:attachment')
  })

  it('does not navigate the current tab when the popup is blocked', async () => {
    window.open = vi.fn(() => null)

    const wrapper = mount(AttachmentMarkdownContent, {
      props: {
        markdown: '[Spec.pdf](msgnr-attachment://document/doc-1/att-2)',
      },
    })

    await wrapper.get('[data-testid="attachment-markdown-file-link"]').trigger('click')
    await flushPromises()

    expect(fetchOwnedAttachmentBlob).not.toHaveBeenCalled()
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
