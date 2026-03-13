import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskComments from '@/components/tasks/TaskComments.vue'
import {
  tasksCreateComment,
  tasksFetchCommentAttachmentBlob,
  tasksListComments,
  tasksUploadCommentAttachment,
} from '@/services/http/tasksApi'

vi.mock('@/services/http/tasksApi', () => ({
  tasksListComments: vi.fn(),
  tasksCreateComment: vi.fn(),
  tasksUploadCommentAttachment: vi.fn(),
  tasksDeleteCommentAttachment: vi.fn(),
  tasksFetchCommentAttachmentBlob: vi.fn(),
}))

describe('TaskComments', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    vi.mocked(tasksListComments).mockResolvedValue([])
    vi.mocked(tasksFetchCommentAttachmentBlob).mockResolvedValue(new Blob(['preview']))
    vi.mocked(tasksCreateComment).mockResolvedValue({
      id: 'comment-1',
      task_id: 'task-1',
      author_id: 'user-1',
      body: '',
      created_at: '2026-03-10T12:00:00Z',
      updated_at: '2026-03-10T12:00:00Z',
      attachments: [],
    })

    ;(globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:mock')
    ;(globalThis.URL as any).revokeObjectURL = vi.fn()
  })

  it('uploads dropped files onto the comment textarea', async () => {
    vi.mocked(tasksUploadCommentAttachment).mockResolvedValue({
      id: 'att-1',
      task_id: 'task-1',
      file_name: 'notes.txt',
      file_size: 5,
      mime_type: 'text/plain',
      uploaded_by: 'user-1',
      created_at: '2026-03-10T12:00:00Z',
    })

    const wrapper = mount(TaskComments, {
      props: { taskId: 'task-1' },
    })
    await flushPromises()

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await wrapper.get('textarea').trigger('drop', {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    })
    await flushPromises()

    expect(tasksUploadCommentAttachment).toHaveBeenCalledWith('task-1', file)
    expect(wrapper.text()).toContain('notes.txt')
  })

  it('uploads pasted clipboard files onto the comment textarea', async () => {
    vi.mocked(tasksUploadCommentAttachment).mockResolvedValue({
      id: 'att-paste-1',
      task_id: 'task-1',
      file_name: 'clipboard.png',
      file_size: 7,
      mime_type: 'image/png',
      uploaded_by: 'user-1',
      created_at: '2026-03-10T12:00:00Z',
    })

    const wrapper = mount(TaskComments, {
      props: { taskId: 'task-1' },
    })
    await flushPromises()

    const file = new File(['clip'], 'clipboard.png', { type: 'image/png' })
    await wrapper.get('textarea').trigger('paste', {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => file }],
        files: [file],
      },
    })
    await flushPromises()

    expect(tasksUploadCommentAttachment).toHaveBeenCalledTimes(1)
    expect(tasksUploadCommentAttachment).toHaveBeenCalledWith('task-1', file)
    expect(wrapper.text()).toContain('clipboard.png')
  })

  it('submits attachment-only comment with attachment_ids payload', async () => {
    vi.mocked(tasksUploadCommentAttachment).mockResolvedValue({
      id: 'att-1',
      task_id: 'task-1',
      file_name: 'file.png',
      file_size: 9,
      mime_type: 'image/png',
      uploaded_by: 'user-1',
      created_at: '2026-03-10T12:00:00Z',
    })

    vi.mocked(tasksCreateComment).mockResolvedValue({
      id: 'comment-2',
      task_id: 'task-1',
      author_id: 'user-1',
      body: '',
      created_at: '2026-03-10T12:01:00Z',
      updated_at: '2026-03-10T12:01:00Z',
      attachments: [{
        id: 'att-1',
        task_id: 'task-1',
        comment_id: 'comment-2',
        file_name: 'file.png',
        file_size: 9,
        mime_type: 'image/png',
        uploaded_by: 'user-1',
        created_at: '2026-03-10T12:00:00Z',
      }],
    })

    const wrapper = mount(TaskComments, {
      props: { taskId: 'task-1' },
    })
    await flushPromises()

    const file = new File(['img-data'], 'file.png', { type: 'image/png' })
    await wrapper.get('textarea').trigger('drop', {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    })
    await flushPromises()

    await wrapper.get('button.bg-accent').trigger('click')
    await flushPromises()

    expect(tasksCreateComment).toHaveBeenCalledWith('task-1', {
      body: '',
      attachment_ids: ['att-1'],
    })
  })

  it('renders rich attachment branches for image/video/audio and generic file', async () => {
    vi.mocked(tasksListComments).mockResolvedValue([{
      id: 'comment-rich',
      task_id: 'task-1',
      author_id: 'user-1',
      body: 'check files',
      created_at: '2026-03-10T12:00:00Z',
      updated_at: '2026-03-10T12:00:00Z',
      attachments: [
        {
          id: 'img-1',
          task_id: 'task-1',
          comment_id: 'comment-rich',
          file_name: 'photo.jpg',
          file_size: 10,
          mime_type: 'image/jpeg',
          uploaded_by: 'user-1',
          created_at: '2026-03-10T12:00:00Z',
        },
        {
          id: 'vid-1',
          task_id: 'task-1',
          comment_id: 'comment-rich',
          file_name: 'clip.mp4',
          file_size: 20,
          mime_type: 'video/mp4',
          uploaded_by: 'user-1',
          created_at: '2026-03-10T12:00:00Z',
        },
        {
          id: 'aud-1',
          task_id: 'task-1',
          comment_id: 'comment-rich',
          file_name: 'voice.ogg',
          file_size: 30,
          mime_type: 'audio/ogg',
          uploaded_by: 'user-1',
          created_at: '2026-03-10T12:00:00Z',
        },
        {
          id: 'doc-1',
          task_id: 'task-1',
          comment_id: 'comment-rich',
          file_name: 'notes.pdf',
          file_size: 1024,
          mime_type: 'application/pdf',
          uploaded_by: 'user-1',
          created_at: '2026-03-10T12:00:00Z',
        },
      ],
    }])

    const wrapper = mount(TaskComments, {
      props: { taskId: 'task-1' },
    })
    await flushPromises()

    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.find('video').exists()).toBe(true)
    expect(wrapper.find('audio').exists()).toBe(true)
    expect(wrapper.text()).toContain('1.0 KB')
  })

  it('clears drag-over state on dragleave even when dataTransfer types are unavailable', async () => {
    const wrapper = mount(TaskComments, {
      props: { taskId: 'task-1' },
    })
    await flushPromises()

    const textarea = wrapper.get('textarea')
    const dropZone = textarea.element.parentElement as HTMLElement

    await textarea.trigger('dragenter', {
      dataTransfer: {
        files: [new File(['x'], 'a.txt', { type: 'text/plain' })],
        types: ['Files'],
      },
    })
    expect(dropZone.className).toContain('border-accent')

    // Simulate browser behavior where dragleave does not include dataTransfer.types.
    await textarea.trigger('dragleave')
    expect(dropZone.className).toContain('border-chat-border')
  })
})
