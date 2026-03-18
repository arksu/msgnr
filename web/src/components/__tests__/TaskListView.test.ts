import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskListView from '@/components/tasks/TaskListView.vue'

const tasksStoreMock = reactive({
  activeStatuses: [] as Array<{ id: string; name: string }>,
  activeTemplates: [] as Array<{ id: string; prefix: string }>,
  assigneeFieldIds: [] as string[],
  users: [] as Array<{ id: string; display_name: string; email: string; avatar_url: string }>,
  listParams: { page: 1, page_size: 50 },
  taskListTotal: 1,
  taskListLoading: false,
  taskListError: null as string | null,
  taskList: [] as Array<{ id: string; public_id: string; title: string; status_id: string; created_at: string; updated_at: string }>,
  groupedTaskStatusOrder: ['st-1', 'st-2'],
  groupedTaskGroupsByStatus: {
    'st-1': {
      status: { id: 'st-1', code: 'todo', name: 'Todo', sort_order: 1 },
      items: [
        {
          id: 'task-grouped-1',
          public_id: 'BUG-1',
          title: 'Grouped Task',
          description_preview: 'Grouped task description',
          status_id: 'st-1',
          created_at: '2026-01-01T00:00:00Z',
          created_by: { id: 'u-1', display_name: 'User One', avatar_url: '' },
        },
      ],
      total: 1,
      next_offset: 1,
      has_more: true,
      loading_more: false,
    },
    'st-2': {
      status: { id: 'st-2', code: 'done', name: 'Done', sort_order: 2 },
      items: [],
      total: 0,
      next_offset: 0,
      has_more: false,
      loading_more: false,
    },
  } as Record<string, any>,
  openCreateDialog: vi.fn(),
  statusById: vi.fn((id: string) => id),
  activeFieldsFor: vi.fn(() => []),
  loadConfig: vi.fn(async () => {}),
  loadAllTemplateFields: vi.fn(async () => {}),
  loadUsers: vi.fn(async () => {}),
  setListParams: vi.fn(),
  loadTaskList: vi.fn(),
  loadMoreGroupedStatus: vi.fn(),
})

vi.mock('@/stores/tasks', () => ({
  useTasksStore: () => tasksStoreMock,
}))

describe('TaskListView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders list/grouped switcher without kanban option', async () => {
    const wrapper = mount(TaskListView, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskTrackerFilters: { template: '<div><slot name="after-controls" /></div>' },
          UserAvatar: { template: '<div class="user-avatar-stub" />' },
          TaskRow: { template: '<tr />' },
          SortIcon: { template: '<span />' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('list')
    expect(wrapper.text()).toContain('group by status')
    expect(wrapper.text().toLowerCase()).not.toContain('kanban')
  })

  it('shows only non-zero groups and triggers show-more loading', async () => {
    localStorage.setItem('msgnr:tasks:view-mode:v1', 'grouped')
    const wrapper = mount(TaskListView, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskTrackerFilters: { template: '<div><slot name="after-controls" /></div>' },
          UserAvatar: { template: '<div class="user-avatar-stub" />' },
          TaskRow: { template: '<tr />' },
          SortIcon: { template: '<span />' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Todo')
    expect(wrapper.text()).not.toContain('Done')
    expect(wrapper.text()).toContain('show more…')

    const showMoreButton = wrapper.findAll('button').find(button => button.text().includes('show more…'))
    expect(showMoreButton).toBeTruthy()
    await showMoreButton!.trigger('click')
    expect(tasksStoreMock.loadMoreGroupedStatus).toHaveBeenCalledWith('st-1')
  })

  it('applies shared filter payload in grouped mode', async () => {
    localStorage.setItem('msgnr:tasks:view-mode:v1', 'grouped')
    const wrapper = mount(TaskListView, {
      props: { templateFilter: null },
      global: {
        stubs: {
          TaskTrackerFilters: {
            emits: ['filtersChange'],
            template: '<div><slot name="after-controls" /><button data-testid="filters-emit" @click="$emit(\'filtersChange\', { search: \'bug\', status_ids: [\'st-1\'], prefixes: [\'BUG\'], field_filters: [{ field_definition_id: \'fld-1\', user_ids: [\'u-1\'] }] })">emit</button></div>',
          },
          UserAvatar: { template: '<div class="user-avatar-stub" />' },
          TaskRow: { template: '<tr />' },
          SortIcon: { template: '<span />' },
        },
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="filters-emit"]').trigger('click')
    expect(tasksStoreMock.setListParams).toHaveBeenCalledWith({
      search: 'bug',
      status_ids: ['st-1'],
      prefixes: ['BUG'],
      field_filters: [{ field_definition_id: 'fld-1', user_ids: ['u-1'] }],
      page: 1,
    }, 'grouped')
  })
})
