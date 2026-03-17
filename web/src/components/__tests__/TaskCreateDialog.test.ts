import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskCreateDialog from '@/components/tasks/TaskCreateDialog.vue'

const tasksStoreMock = reactive({
  createDialogOpen: true,
  configError: null as string | null,
  configLoading: false,
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
  users: [],
  enumItemsFor: vi.fn(() => []),
  activeFieldsFor: vi.fn(() => []),
  enumVersionFor: vi.fn(() => undefined),
  loadConfig: vi.fn(async () => {}),
  loadFieldsFor: vi.fn(async () => {}),
  loadUsers: vi.fn(async () => {}),
  loadEnumItemsFor: vi.fn(async () => {}),
  closeCreateDialog: vi.fn(),
  createTask: vi.fn(async () => ({
    id: 'task-1',
  })),
})

vi.mock('@/stores/tasks', () => ({
  useTasksStore: () => tasksStoreMock,
}))

describe('TaskCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tasksStoreMock.createDialogOpen = true
  })

  it('submits trimmed markdown description', async () => {
    tasksStoreMock.createDialogOpen = false
    const wrapper = mount(TaskCreateDialog, {
      global: {
        stubs: {
          Teleport: true,
          TaskFieldInput: true,
          TaskDescriptionEditor: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<textarea data-testid="description-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })
    tasksStoreMock.createDialogOpen = true
    await wrapper.vm.$nextTick()
    await flushPromises()

    const templateButton = wrapper.findAll('button').find(button => button.text() === 'TASK')
    expect(templateButton).toBeTruthy()
    await templateButton!.trigger('click')
    await wrapper.get('select').setValue('st-1')
    await wrapper.get('input[placeholder="Task title"]').setValue('New task')
    await wrapper.get('[data-testid="description-stub"]').setValue('  ## Title\\n\\nBody  ')
    const createButton = wrapper.findAll('button').find(button => button.text() === 'Create task')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    expect(tasksStoreMock.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New task',
      description: '## Title\\n\\nBody',
      status_id: 'st-1',
    }))
  })

  it('sends null description when markdown is blank after trim', async () => {
    tasksStoreMock.createDialogOpen = false
    const wrapper = mount(TaskCreateDialog, {
      global: {
        stubs: {
          Teleport: true,
          TaskFieldInput: true,
          TaskDescriptionEditor: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<textarea data-testid="description-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })
    tasksStoreMock.createDialogOpen = true
    await wrapper.vm.$nextTick()
    await flushPromises()

    const templateButton = wrapper.findAll('button').find(button => button.text() === 'TASK')
    expect(templateButton).toBeTruthy()
    await templateButton!.trigger('click')
    await wrapper.get('select').setValue('st-1')
    await wrapper.get('input[placeholder="Task title"]').setValue('Task without description')
    await wrapper.get('[data-testid="description-stub"]').setValue('   ')
    const createButton = wrapper.findAll('button').find(button => button.text() === 'Create task')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    expect(tasksStoreMock.createTask).toHaveBeenCalledWith(expect.objectContaining({
      description: null,
    }))
  })
})
