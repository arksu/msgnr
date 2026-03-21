import { reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskCard from '@/components/tasks/TaskCard.vue'
import type { TaskDescriptionHistoryItem } from '@/services/http/tasksApi'

const selectedTask = {
  id: 'task-1',
  public_id: 'TASK-1',
  template_id: 'tpl-1',
  template_snapshot_prefix: 'TASK',
  sequence_number: 1,
  title: 'Initial title',
  description: '**old** description',
  status_id: 'st-1',
  parent_task_id: null,
  parent_public_id: null,
  created_by: 'u-1',
  updated_by: 'u-1',
  created_at: '2026-03-10T12:00:00Z',
  updated_at: '2026-03-10T12:00:00Z',
  field_values: [],
  subtasks: [],
}

const tasksStoreMock = reactive({
  selectedTask,
  taskLoading: false,
  taskError: null as string | null,
  users: [],
  activeTemplates: [
    {
      id: 'tpl-1',
      prefix: 'TASK',
      sort_order: 1,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      created_by: 'u-1',
      updated_by: 'u-1',
    },
  ],
  activeStatuses: [
    {
      id: 'st-1',
      code: 'open',
      name: 'Open',
      sort_order: 1,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      created_by: 'u-1',
      updated_by: 'u-1',
    },
  ],
  allStatuses: vi.fn(() => [
    {
      id: 'st-1',
      code: 'open',
      name: 'Open',
      sort_order: 1,
      deleted_at: null,
    },
  ]),
  statusById: vi.fn(() => ({ id: 'st-1', name: 'Open' })),
  activeFieldsFor: vi.fn(() => []),
  enumDictionaryFor: vi.fn(() => undefined),
  enumItemsFor: vi.fn(() => []),
  enumKnownItemsFor: vi.fn(() => []),
  enumItemCreateLoadingFor: vi.fn(() => false),
  enumItemSearchLoadingFor: vi.fn(() => false),
  enumVersionFor: vi.fn(() => undefined),
  loadUsers: vi.fn(async () => {}),
  loadEnumItemsFor: vi.fn(async () => {}),
  searchEnumItemsFor: vi.fn(async () => []),
  loadConfig: vi.fn(async () => {}),
  loadFieldsFor: vi.fn(async () => {}),
  updateTask: vi.fn(async () => selectedTask),
  updateTaskTitle: vi.fn(async () => selectedTask),
  updateTaskStatus: vi.fn(async () => selectedTask),
  updateTaskDescription: vi.fn(async () => selectedTask),
  listTaskDescriptionHistory: vi.fn(async (): Promise<TaskDescriptionHistoryItem[]> => []),
  updateTaskFieldValue: vi.fn(async () => ({})),
  createSubtask: vi.fn(async () => ({})),
  selectTask: vi.fn(async () => {}),
})

const chatStoreMock = {
  showToast: vi.fn(),
}

vi.mock('@/stores/tasks', () => ({
  useTasksStore: () => tasksStoreMock,
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => chatStoreMock,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: {
      id: 'u-1',
      email: 'u-1@example.com',
      displayName: 'User 1',
    },
  }),
}))

vi.mock('@/composables/useTaskDescriptionCollab', () => ({
  useTaskDescriptionCollab: () => ({
    doc: ref({}),
    provider: ref({ awareness: { states: new Map() } }),
    subscribeError: ref(''),
    serverMarkdown: ref<string | null>(null),
    allowLocalDraftSeed: ref(true),
  }),
}))

describe('TaskCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tasksStoreMock.listTaskDescriptionHistory = vi.fn(async (): Promise<TaskDescriptionHistoryItem[]> => [])
    tasksStoreMock.selectedTask = {
      ...selectedTask,
      description: '**old** description',
      subtasks: [],
    }
  })

  it('shows rendered/markdown tabs in always-on description editor', async () => {
    const wrapper = mount(TaskCard, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskFieldInput: true,
          UserAvatar: true,
          TaskAttachments: true,
          TaskComments: true,
          TaskDescriptionEditor: {
            template: '<div>Rendered Markdown</div>',
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Rendered')
    expect(wrapper.text()).toContain('Markdown')
    expect(wrapper.text()).not.toContain('Edit')
  })

  it('autosaves trimmed markdown description without edit mode', async () => {
    vi.useFakeTimers()
    const wrapper = mount(TaskCard, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskFieldInput: true,
          UserAvatar: true,
          TaskAttachments: true,
          TaskComments: true,
          TaskDescriptionEditor: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<textarea data-testid="description-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="description-stub"]').setValue('  ## Edited\\n\\nBody  ')
    vi.advanceTimersByTime(900)
    await flushPromises()

    expect(tasksStoreMock.updateTaskDescription).toHaveBeenCalledWith('task-1', '## Edited\\n\\nBody')
    vi.useRealTimers()
  })

  it('sends null description when markdown is empty', async () => {
    vi.useFakeTimers()
    const wrapper = mount(TaskCard, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskFieldInput: true,
          UserAvatar: true,
          TaskAttachments: true,
          TaskComments: true,
          TaskDescriptionEditor: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<textarea data-testid="description-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="description-stub"]').setValue('   ')
    vi.advanceTimersByTime(900)
    await flushPromises()

    expect(tasksStoreMock.updateTaskDescription).toHaveBeenCalledWith('task-1', null)
    vi.useRealTimers()
  })

  it('creates subtask with trimmed markdown description', async () => {
    const wrapper = mount(TaskCard, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskFieldInput: true,
          UserAvatar: true,
          TaskAttachments: true,
          TaskComments: true,
          TaskDescriptionEditor: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<textarea data-testid="description-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })
    await flushPromises()

    const addSubtaskButton = wrapper.findAll('button').find(button => button.text() === '+ Add subtask')
    expect(addSubtaskButton).toBeTruthy()
    await addSubtaskButton!.trigger('click')
    await flushPromises()

    await wrapper.get('input[placeholder="Subtask title"]').setValue('Subtask A')
    await wrapper.get('[data-testid="description-stub"]').setValue('  - one\\n- two  ')
    const createButton = wrapper.findAll('button').find(button => button.text() === 'Create subtask')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    expect(tasksStoreMock.createSubtask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      template_id: 'tpl-1',
      status_id: 'st-1',
      description: '- one\\n- two',
    }))
  })

  it('opens history modal, updates preview on item click, and applies with force snapshot', async () => {
    tasksStoreMock.listTaskDescriptionHistory = vi.fn(async () => [
      {
        public_id: 'TASK-1',
        title: 'Newest title',
        description: '## Newest',
        edited_by: 'u-2',
        created_at: '2026-03-11T10:00:00Z',
        editor: {
          id: 'u-2',
          display_name: 'Editor User',
          avatar_url: '',
        },
      },
      {
        public_id: 'TASK-1',
        title: 'Older title',
        description: '## Older',
        edited_by: 'u-3',
        created_at: '2026-03-10T10:00:00Z',
        editor: {
          id: 'u-3',
          display_name: 'Another User',
          avatar_url: '',
        },
      },
    ])

    const wrapper = mount(TaskCard, {
      props: { templateFilter: null },
      attachTo: document.body,
      global: {
        stubs: {
          TaskFieldInput: true,
          UserAvatar: true,
          TaskAttachments: true,
          TaskComments: true,
          TaskDescriptionEditor: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<textarea data-testid="description-stub" :value="modelValue" />',
          },
        },
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="task-description-history-toggle"]').trigger('click')
    await flushPromises()
    expect(tasksStoreMock.listTaskDescriptionHistory).toHaveBeenCalledWith('task-1')
    expect(document.body.querySelector('[data-testid="task-description-restore-modal"] > div')?.className).toContain('w-[90vw]')
    expect(document.body.querySelector('[data-testid="task-description-restore-modal"] > div')?.className).toContain('h-[90vh]')
    expect((document.body.querySelector('[data-testid="task-description-history-preview-title"]') as HTMLInputElement | null)?.value).toBe('Newest title')

    const historyItems = document.body.querySelectorAll('[data-testid="task-description-history-item"]')
    expect(historyItems.length).toBe(2)
    ;(historyItems[1] as HTMLButtonElement).click()
    await flushPromises()
    expect((document.body.querySelector('[data-testid="task-description-history-preview-title"]') as HTMLInputElement | null)?.value).toBe('Older title')

    const applyButton = document.body.querySelector('[data-testid="task-description-restore-apply"]') as HTMLButtonElement | null
    expect(applyButton).not.toBeNull()
    applyButton?.click()
    await flushPromises()

    expect(tasksStoreMock.updateTaskDescription).toHaveBeenCalledWith('task-1', '## Older', { forceSnapshot: true })
    wrapper.unmount()
  })
})
