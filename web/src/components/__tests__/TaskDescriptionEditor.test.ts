import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref, watch } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import TaskDescriptionEditor from '@/components/tasks/TaskDescriptionEditor.vue'
import { uploadOwnedAttachment } from '@/services/http/attachmentOwnersApi'

vi.mock('@/services/http/attachmentOwnersApi', () => ({
  uploadOwnedAttachment: vi.fn(),
  fetchOwnedAttachmentBlob: vi.fn(),
}))

describe('TaskDescriptionEditor', () => {
  async function waitForRenderedEditor(wrapper: ReturnType<typeof mount>) {
    for (let i = 0; i < 10; i += 1) {
      await flushPromises()
      await nextTick()
      if (wrapper.find('[data-testid="task-description-editor-content"] .ProseMirror').exists()) {
        return
      }
    }
    throw new Error('rendered editor did not mount')
  }

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

  it('syncs markdown-tab edits into the collab-backed rendered editor', async () => {
    const collabDoc = new Y.Doc()
    collabDoc.getXmlFragment('task_description')
    const richEditorStub = defineComponent({
      name: 'TaskDescriptionRichEditor',
      props: {
        modelValue: {
          type: String,
          required: true,
        },
        forceLocalSyncToken: {
          type: Number,
          default: 0,
        },
      },
      setup(props) {
        const renderedValue = ref(props.modelValue)

        watch(
          () => props.forceLocalSyncToken,
          (next, prev) => {
            if (next === prev) return
            renderedValue.value = props.modelValue
          },
        )

        return {
          renderedValue,
        }
      },
      template: '<div data-testid="task-description-editor-content"><div class="ProseMirror">{{ renderedValue }}</div></div>',
    })

    const wrapper = mount(TaskDescriptionEditor, {
      props: {
        modelValue: '**Old** text',
        defaultTab: 'rendered',
        collabDoc,
      },
      attachTo: document.body,
      global: {
        stubs: {
          TaskDescriptionRichEditor: richEditorStub,
        },
      },
    })
    await waitForRenderedEditor(wrapper)

    await wrapper.get('[data-testid="task-description-tab-markdown"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-description-markdown-input"]').setValue('## Edited\n\nBody')
    await flushPromises()

    await wrapper.get('[data-testid="task-description-tab-rendered"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="task-description-editor-content"] .ProseMirror').text()).toContain('## Edited')
    expect(wrapper.get('[data-testid="task-description-editor-content"] .ProseMirror').text()).toContain('Body')
  })
})
