import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskCard from '@/components/tasks/TaskCard.vue'

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
  descriptionViewMode: 'rendered' as 'rendered' | 'markdown',
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
  enumItemsFor: vi.fn(() => []),
  enumVersionFor: vi.fn(() => undefined),
  loadUsers: vi.fn(async () => {}),
  loadEnumItemsFor: vi.fn(async () => {}),
  loadConfig: vi.fn(async () => {}),
  loadFieldsFor: vi.fn(async () => {}),
  updateTask: vi.fn(async () => selectedTask),
  updateTaskTitle: vi.fn(async () => selectedTask),
  updateTaskStatus: vi.fn(async () => selectedTask),
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

describe('TaskCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tasksStoreMock.selectedTask = {
      ...selectedTask,
      description: '**old** description',
      subtasks: [],
    }
    tasksStoreMock.descriptionViewMode = 'rendered'
  })

  it('shows Markdown label for non-edit description toggle', async () => {
    const wrapper = mount(TaskCard, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskFieldInput: true,
          TaskAttachments: true,
          TaskComments: true,
          TaskDescriptionEditor: true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Rendered')
    expect(wrapper.text()).toContain('Markdown')
    expect(wrapper.text()).not.toContain('Raw')
  })

  it('saves trimmed markdown description in edit mode', async () => {
    const wrapper = mount(TaskCard, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskFieldInput: true,
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

    const editButton = wrapper.findAll('button').find(button => button.text() === 'Edit')
    expect(editButton).toBeTruthy()
    await editButton!.trigger('click')

    await wrapper.get('[data-testid="description-stub"]').setValue('  ## Edited\\n\\nBody  ')
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save')
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(tasksStoreMock.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      description: '## Edited\\n\\nBody',
    }))
  })

  it('creates subtask with trimmed markdown description', async () => {
    const wrapper = mount(TaskCard, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskFieldInput: true,
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
})
