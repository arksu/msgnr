import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskDescriptionRichEditor from '@/components/tasks/TaskDescriptionRichEditor.vue'
import { fetchOwnedAttachmentBlob, uploadOwnedAttachment } from '@/services/http/attachmentOwnersApi'

vi.mock('@/services/http/attachmentOwnersApi', () => ({
  uploadOwnedAttachment: vi.fn(),
  fetchOwnedAttachmentBlob: vi.fn(),
}))

describe('TaskDescriptionRichEditor', () => {
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

  async function waitForRichEditor(wrapper: ReturnType<typeof mount>) {
    for (let i = 0; i < 10; i += 1) {
      await flushPromises()
      await nextTick()
      if (wrapper.find('[data-testid="task-description-editor-content"] .ProseMirror').exists()) {
        return
      }
    }
  }

  it('uploads image files from the rendered editor and serializes them back to markdown tokens', async () => {
    vi.mocked(uploadOwnedAttachment).mockResolvedValue({
      id: 'att-image',
      file_name: 'Photo.png',
      mime_type: 'image/png',
    })

    const wrapper = mount(TaskDescriptionRichEditor, {
      props: {
        modelValue: '',
        ownerKind: 'task',
        ownerId: 'task-1',
        uploadAttachments: async (files: File[]) => Promise.all(files.map(file => uploadOwnedAttachment('task', 'task-1', file))),
      },
      attachTo: document.body,
    })
    await waitForRichEditor(wrapper)

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
    expect(uploadOwnedAttachment).toHaveBeenCalledWith('task', 'task-1', expect.any(File))
    expect(fetchOwnedAttachmentBlob).toHaveBeenCalledWith('task', 'task-1', 'att-image')
  })

  it('opens attachment links from the rendered editor on click', async () => {
    const wrapper = mount(TaskDescriptionRichEditor, {
      props: {
        modelValue: '[Spec.pdf](msgnr-attachment://document/doc-1/att-2)',
        ownerKind: 'document',
        ownerId: 'doc-1',
        uploadAttachments: vi.fn(),
      },
      attachTo: document.body,
    })
    await waitForRichEditor(wrapper)

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
    const wrapper = mount(TaskDescriptionRichEditor, {
      props: {
        modelValue: '[OpenAI](https://openai.com)',
        uploadAttachments: vi.fn(),
      },
      attachTo: document.body,
    })
    await waitForRichEditor(wrapper)

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
})
