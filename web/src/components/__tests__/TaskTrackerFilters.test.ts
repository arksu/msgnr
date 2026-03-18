import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskTrackerFilters from '@/components/tasks/TaskTrackerFilters.vue'

const tasksStoreMock = reactive({
  activeStatuses: [{ id: 'st-1', name: 'Todo' }],
  activeTemplates: [{ id: 'tpl-1', prefix: 'BUG' }],
  assigneeFieldIds: ['fld-assignee'],
  users: [{ id: 'u-1', display_name: 'Ada', email: 'ada@example.com', avatar_url: '' }],
  loadConfig: vi.fn(async () => {}),
  loadAllTemplateFields: vi.fn(async () => {}),
  loadUsers: vi.fn(async () => {}),
  activeFieldsFor: vi.fn(() => [{ id: 'fld-assignee', field_role: 'assignee', deleted_at: null }]),
})

vi.mock('@/stores/tasks', () => ({
  useTasksStore: () => tasksStoreMock,
}))

describe('TaskTrackerFilters', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    tasksStoreMock.activeFieldsFor.mockReset()
    tasksStoreMock.activeFieldsFor.mockReturnValue([{ id: 'fld-assignee', field_role: 'assignee', deleted_at: null }])
  })

  it('emits normalized filter payload for search + status + template + assignee', async () => {
    vi.useFakeTimers()
    const wrapper = mount(TaskTrackerFilters, {
      props: {
        templateFilter: null,
        total: 1,
      },
      global: {
        stubs: {
          UserAvatar: { template: '<div />' },
        },
      },
    })
    await flushPromises()

    await wrapper.get('input[placeholder="Search by ID, title, description…"]').setValue('  bug  ')
    await wrapper.get('input[placeholder="Search by ID, title, description…"]').trigger('input')
    vi.advanceTimersByTime(300)
    await flushPromises()

    await wrapper.get('button.toolbar-btn').trigger('click')

    const statusChip = wrapper.findAll('button.filter-chip').find(btn => btn.text().includes('Status'))
    expect(statusChip).toBeTruthy()
    await statusChip!.trigger('click')
    await wrapper.get('input[type="checkbox"][value="st-1"]').setValue(true)

    const templateChip = wrapper.findAll('button.filter-chip').find(btn => btn.text().includes('Template'))
    expect(templateChip).toBeTruthy()
    await templateChip!.trigger('click')
    await wrapper.findAll('button.dropdown-item').find(btn => btn.text().includes('BUG'))!.trigger('click')

    const assigneeChip = wrapper.findAll('button.filter-chip').find(btn => btn.text().includes('Assignee'))
    expect(assigneeChip).toBeTruthy()
    await assigneeChip!.trigger('click')
    await wrapper.get('input[type="checkbox"][value="u-1"]').setValue(true)

    const emitted = wrapper.emitted('filtersChange')
    expect(emitted).toBeTruthy()
    const latest = emitted![emitted!.length - 1][0] as any
    expect(latest).toEqual({
      search: 'bug',
      status_ids: ['st-1'],
      prefixes: ['BUG'],
      field_filters: [{ field_definition_id: 'fld-assignee', user_ids: ['u-1'] }],
    })
  })

  it('reacts to templateFilter prop changes', async () => {
    const wrapper = mount(TaskTrackerFilters, {
      props: {
        templateFilter: null,
        total: 1,
      },
      global: {
        stubs: {
          UserAvatar: { template: '<div />' },
        },
      },
    })
    await flushPromises()

    await wrapper.setProps({ templateFilter: 'tpl-1' })
    await flushPromises()

    const emitted = wrapper.emitted('filtersChange')
    expect(emitted).toBeTruthy()
    const latest = emitted![emitted!.length - 1][0] as any
    expect(latest.prefixes).toEqual(['BUG'])
  })
})
