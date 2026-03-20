import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskDescriptionEditor from '@/components/tasks/TaskDescriptionEditor.vue'
import { fetchOwnedAttachmentBlob, uploadOwnedAttachment } from '@/services/http/attachmentOwnersApi'

vi.mock('@/services/http/attachmentOwnersApi', () => ({
  uploadOwnedAttachment: vi.fn(),
  fetchOwnedAttachmentBlob: vi.fn(),
}))

describe('TaskDescriptionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:editor')
    globalThis.URL.revokeObjectURL = vi.fn()
    window.open = vi.fn(() => ({
      location: {
        replace: vi.fn(),
      },
      focus: vi.fn(),
      close: vi.fn(),
    } as unknown as Window))
    vi.mocked(fetchOwnedAttachmentBlob).mockResolvedValue(new Blob(['img'], { type: 'image/png' }))
  })

  it('uploads dropped files from the markdown tab and inserts tokens at the cursor', async () => {
    vi.mocked(uploadOwnedAttachment)
      .mockResolvedValueOnce({
        id: 'att-file',
        file_name: 'Spec.pdf',
        mime_type: 'application/pdf',
      })
      .mockResolvedValueOnce({
        id: 'att-image',
        file_name: 'Photo.png',
        mime_type: 'image/png',
      })

    const wrapper = mount(TaskDescriptionEditor, {
      props: {
        modelValue: 'Before',
        defaultTab: 'markdown',
        ownerKind: 'task',
        ownerId: 'task-1',
      },
    })

    const input = wrapper.get('[data-testid="task-description-markdown-input"]')
    ;(input.element as HTMLTextAreaElement).setSelectionRange(6, 6)

    await input.trigger('paste', {
      clipboardData: {
        files: [
          new File(['pdf'], 'Spec.pdf', { type: 'application/pdf' }),
          new File(['img'], 'Photo.png', { type: 'image/png' }),
        ],
      },
    })
    await flushPromises()

    const updates = wrapper.emitted('update:modelValue') ?? []
    const latest = updates[updates.length - 1]?.[0] as string
    expect(latest).toContain('[Spec.pdf](msgnr-attachment://task/task-1/att-file)')
    expect(latest).toContain('![Photo.png](msgnr-attachment://task/task-1/att-image)')
    expect(String(latest)).toMatch(/\[Spec\.pdf\].*!\[Photo\.png\]/s)
  })

  it('uploads multiple files in parallel and preserves result order', async () => {
    type UploadedAttachmentStub = {
      id: string
      file_name: string
      mime_type: string
    }

    let firstResolverAssigned = false
    let secondResolverAssigned = false
    let resolveFirst: (value: UploadedAttachmentStub) => void = () => {
      throw new Error('first resolver was not assigned')
    }
    let resolveSecond: (value: UploadedAttachmentStub) => void = () => {
      throw new Error('second resolver was not assigned')
    }
    vi.mocked(uploadOwnedAttachment)
      .mockImplementationOnce(() => new Promise<UploadedAttachmentStub>((resolve) => {
        firstResolverAssigned = true
        resolveFirst = resolve
      }))
      .mockImplementationOnce(() => new Promise<UploadedAttachmentStub>((resolve) => {
        secondResolverAssigned = true
        resolveSecond = resolve
      }))

    const wrapper = mount(TaskDescriptionEditor, {
      props: {
        modelValue: '',
        defaultTab: 'markdown',
        ownerKind: 'task',
        ownerId: 'task-1',
      },
    })

    const input = wrapper.get('[data-testid="task-description-markdown-input"]')
    const pastePromise = input.trigger('paste', {
      clipboardData: {
        files: [
          new File(['pdf'], 'Spec.pdf', { type: 'application/pdf' }),
          new File(['img'], 'Photo.png', { type: 'image/png' }),
        ],
      },
    })
    await Promise.resolve()

    expect(uploadOwnedAttachment).toHaveBeenNthCalledWith(1, 'task', 'task-1', expect.any(File))
    expect(uploadOwnedAttachment).toHaveBeenNthCalledWith(2, 'task', 'task-1', expect.any(File))

    expect(secondResolverAssigned).toBe(true)
    expect(firstResolverAssigned).toBe(true)

    resolveSecond({ id: 'att-image', file_name: 'Photo.png', mime_type: 'image/png' })
    resolveFirst({ id: 'att-file', file_name: 'Spec.pdf', mime_type: 'application/pdf' })
    await pastePromise
    await flushPromises()

    const updates = wrapper.emitted('update:modelValue') ?? []
    const latest = updates[updates.length - 1]?.[0] as string
    expect(String(latest)).toMatch(/\[Spec\.pdf\].*!\[Photo\.png\]/s)
  })

  it('uploads image files from the rendered tab and serializes them back to markdown tokens', async () => {
    vi.mocked(uploadOwnedAttachment).mockResolvedValue({
      id: 'att-image',
      file_name: 'Photo.png',
      mime_type: 'image/png',
    })

    const wrapper = mount(TaskDescriptionEditor, {
      props: {
        modelValue: '',
        ownerKind: 'task',
        ownerId: 'task-1',
      },
      attachTo: document.body,
    })
    await flushPromises()

    const editorEl = wrapper.get('[data-testid="task-description-editor-content"] .ProseMirror')
    await editorEl.trigger('paste', {
      clipboardData: {
        files: [new File(['img'], 'Photo.png', { type: 'image/png' })],
        getData: () => '',
      },
    })
    await flushPromises()

    const updates = wrapper.emitted('update:modelValue') ?? []
    const latest = updates[updates.length - 1]?.[0] as string
    expect(latest).toContain('![Photo.png](msgnr-attachment://task/task-1/att-image)')
    expect(fetchOwnedAttachmentBlob).toHaveBeenCalledWith('task', 'task-1', 'att-image')
  })

  it('opens attachment links from the rendered editor on click', async () => {
    vi.mocked(fetchOwnedAttachmentBlob).mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))

    const wrapper = mount(TaskDescriptionEditor, {
      props: {
        modelValue: '[Spec.pdf](msgnr-attachment://document/doc-1/att-2)',
        ownerKind: 'document',
        ownerId: 'doc-1',
      },
      attachTo: document.body,
    })
    await flushPromises()

    const link = wrapper.get('[data-testid="task-description-editor-content"] .ProseMirror a')
    link.element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }))
    await flushPromises()

    expect(fetchOwnedAttachmentBlob).toHaveBeenCalledWith('document', 'doc-1', 'att-2')
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank')
    const opened = vi.mocked(window.open).mock.results[0]?.value as { location: { replace: ReturnType<typeof vi.fn> } }
    expect(opened.location.replace).toHaveBeenCalledWith('blob:editor')
  })

  it('opens normal markdown links from the rendered editor on click', async () => {
    const wrapper = mount(TaskDescriptionEditor, {
      props: {
        modelValue: '[OpenAI](https://openai.com)',
      },
      attachTo: document.body,
    })
    await flushPromises()

    const link = wrapper.get('[data-testid="task-description-editor-content"] .ProseMirror a')
    link.element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }))
    await flushPromises()

    expect(fetchOwnedAttachmentBlob).not.toHaveBeenCalled()
    expect(window.open).toHaveBeenCalledWith('https://openai.com', '_blank')
    const opened = vi.mocked(window.open).mock.results[0]?.value as { focus: ReturnType<typeof vi.fn> }
    expect(opened.focus).toHaveBeenCalled()
  })

  it('shows a non-error hint and skips uploads when the owner is not saved yet', async () => {
    const wrapper = mount(TaskDescriptionEditor, {
      props: {
        modelValue: '',
        defaultTab: 'markdown',
        ownerKind: 'task',
      },
    })

    await wrapper.get('[data-testid="task-description-markdown-input"]').trigger('paste', {
      clipboardData: {
        files: [new File(['img'], 'Photo.png', { type: 'image/png' })],
      },
    })
    await flushPromises()

    expect(uploadOwnedAttachment).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="task-description-attachment-note"]').text()).toContain('available after save')
  })
})
