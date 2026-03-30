import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import TaskDescriptionRichEditor from '@/components/tasks/TaskDescriptionRichEditor.vue'
import { fetchOwnedAttachmentBlob, uploadOwnedAttachment } from '@/services/http/attachmentOwnersApi'

vi.mock('@/services/http/attachmentOwnersApi', () => ({
  uploadOwnedAttachment: vi.fn(),
  fetchOwnedAttachmentBlob: vi.fn(),
}))

describe('TaskDescriptionRichEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis.Node.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    })
    Object.defineProperty(globalThis.Node.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }),
    })
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

  async function waitForEditorText(wrapper: ReturnType<typeof mount>, expected: string) {
    for (let i = 0; i < 10; i += 1) {
      await flushPromises()
      await nextTick()
      const editorContent = wrapper.find('[data-testid="task-description-editor-content"] .ProseMirror')
      if (editorContent.exists() && editorContent.text().includes(expected)) {
        return
      }
    }
    throw new Error(`editor text did not include ${JSON.stringify(expected)}`)
  }

  async function waitForLatestMarkdownUpdate(wrapper: ReturnType<typeof mount>, expected: string) {
    for (let i = 0; i < 10; i += 1) {
      await flushPromises()
      await nextTick()
      const updates = wrapper.emitted('update:modelValue') ?? []
      const latest = updates[updates.length - 1]?.[0]
      if (latest === expected) {
        return
      }
    }
    throw new Error(`latest markdown update did not equal ${JSON.stringify(expected)}`)
  }

  function getEditor(wrapper: ReturnType<typeof mount>) {
    const editor = wrapper.getComponent({ name: 'EditorContent' }).props('editor') as {
      isEditable: boolean
      commands: {
        clearContent: () => boolean
      }
    } | undefined
    if (!editor) {
      throw new Error('editor did not initialize')
    }
    return editor
  }

  it('renders markdown task items as checkboxes and toggles them back to markdown', async () => {
    const wrapper = mount(TaskDescriptionRichEditor, {
      props: {
        modelValue: '- [ ] Text',
        uploadAttachments: vi.fn(),
      },
      attachTo: document.body,
    })
    await waitForRichEditor(wrapper)

    const checkbox = wrapper.get('[data-testid="task-description-editor-content"] input[type="checkbox"]')
    const checkboxEl = checkbox.element as HTMLInputElement
    expect(checkboxEl.checked).toBe(false)

    checkboxEl.checked = true
    await checkbox.trigger('change')
    await flushPromises()
    await nextTick()

    const updates = wrapper.emitted('update:modelValue') ?? []
    const latest = updates[updates.length - 1]?.[0] as string
    expect(latest).toContain('- [x] Text')
  })

  it('adds task-item markup so checkbox text stays inline', async () => {
    const wrapper = mount(TaskDescriptionRichEditor, {
      props: {
        modelValue: '- [x] text\n- [ ] two',
        uploadAttachments: vi.fn(),
      },
      attachTo: document.body,
    })
    await waitForRichEditor(wrapper)

    const items = wrapper.findAll('[data-testid="task-description-editor-content"] li[data-type="taskItem"]')

    expect(items).toHaveLength(2)
    expect(items[0].attributes('data-type')).toBe('taskItem')
    expect(items[0].find('label').exists()).toBe(true)
    expect(items[0].find('div').exists()).toBe(true)
    expect(items[0].text()).toContain('text')
  })

  it('falls back to rendered markdown when collab doc stays empty', async () => {
    const collabDoc = new Y.Doc()
    collabDoc.getXmlFragment('task_description')

    const wrapper = mount(TaskDescriptionRichEditor, {
      props: {
        modelValue: '**Bold** text',
        collabDoc,
        allowLocalDraftSeed: false,
        uploadAttachments: vi.fn(),
      },
      attachTo: document.body,
    })
    await waitForRichEditor(wrapper)

    expect(wrapper.get('[data-testid="task-description-editor-fallback"] .markdown-body strong').text()).toBe('Bold')
  })

  it('keeps rendered mode editable after local collab content is cleared', async () => {
    const collabDoc = new Y.Doc()
    const collabFragment = collabDoc.getXmlFragment('task_description')

    const wrapper = mount(TaskDescriptionRichEditor, {
      props: {
        modelValue: '**Bold** text',
        collabDoc,
        uploadAttachments: vi.fn(),
      },
      attachTo: document.body,
    })
    await waitForRichEditor(wrapper)
    await waitForEditorText(wrapper, 'Bold')

    const editor = getEditor(wrapper)
    expect(editor.isEditable).toBe(true)

    collabDoc.transact(() => {
      collabFragment.delete(0, collabFragment.length)
    }, 'local-clear')
    await waitForLatestMarkdownUpdate(wrapper, '')

    expect(wrapper.find('[data-testid="task-description-editor-fallback"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="task-description-editor-content"] .ProseMirror').text()).toBe('')
    expect(editor.isEditable).toBe(true)
  })

  it('applies remote collab clears without showing stale rendered fallback', async () => {
    const collabDoc = new Y.Doc()
    collabDoc.getXmlFragment('task_description')

    const wrapper = mount(TaskDescriptionRichEditor, {
      props: {
        modelValue: '**Bold** text',
        collabDoc,
        uploadAttachments: vi.fn(),
      },
      attachTo: document.body,
    })
    await waitForRichEditor(wrapper)
    await waitForEditorText(wrapper, 'Bold')

    const remoteDoc = new Y.Doc()
    const remoteFragment = remoteDoc.getXmlFragment('task_description')
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(collabDoc), 'initial-sync')

    let remoteClearUpdate: Uint8Array | null = null
    remoteDoc.on('update', (update, origin) => {
      if (origin === 'remote-clear') {
        remoteClearUpdate = update
      }
    })
    remoteDoc.transact(() => {
      remoteFragment.delete(0, remoteFragment.length)
    }, 'remote-clear')

    expect(remoteClearUpdate).not.toBeNull()
    Y.applyUpdate(collabDoc, remoteClearUpdate!, 'remote')
    await waitForLatestMarkdownUpdate(wrapper, '')

    expect(wrapper.find('[data-testid="task-description-editor-fallback"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="task-description-editor-content"] .ProseMirror').text()).toBe('')
    expect(getEditor(wrapper).isEditable).toBe(true)
  })

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
    expect(window.open).toHaveBeenCalledWith('https://openai.com/', '_blank')
    const opened = vi.mocked(window.open).mock.results[0]?.value as { focus: ReturnType<typeof vi.fn> }
    expect(opened.focus).toHaveBeenCalled()
  })
})
