import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()

vi.mock('@/services/http/client', () => ({
  createAuthenticatedClient: () => ({
    get: getMock,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

describe('tasksApi task list queries', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('serializes list mode params for GET /api/tasks', async () => {
    getMock.mockResolvedValueOnce({ data: { groups: [], grand_total: 0 } })
    const { tasksListTasks } = await import('@/services/http/tasksApi')

    await tasksListTasks({
      search: 'abc',
      status_ids: ['status-1'],
      prefixes: ['BUG'],
      sort_by: 'created_at',
      sort_order: 'desc',
      page: 2,
      page_size: 50,
    })

    expect(getMock).toHaveBeenCalledTimes(1)
    const [url, config] = getMock.mock.calls[0]
    expect(url).toBe('/api/tasks')
    const query = String((config.params as URLSearchParams).toString())
    expect(query).toContain('search=abc')
    expect(query).toContain('status_id=status-1')
    expect(query).toContain('prefix=BUG')
    expect(query).toContain('sort_by=created_at')
    expect(query).toContain('sort_order=desc')
    expect(query).toContain('page=2')
    expect(query).toContain('page_size=50')
  })

  it('serializes grouped mode params for GET /api/tasks/grouped', async () => {
    getMock.mockResolvedValueOnce({
      data: { status_order: [], groups_by_status: {}, grand_total: 0, limit: 50 },
    })
    const { tasksListGrouped } = await import('@/services/http/tasksApi')

    await tasksListGrouped({
      search: 'need',
      status_ids: ['status-1'],
      prefixes: ['QA'],
      field_filters: [{ field_definition_id: 'fd-1', enum_codes: ['high'] }],
    }, 40)

    expect(getMock).toHaveBeenCalledTimes(1)
    const [url, config] = getMock.mock.calls[0]
    expect(url).toBe('/api/tasks/grouped')
    const query = String((config.params as URLSearchParams).toString())
    expect(query).toContain('search=need')
    expect(query).toContain('status_id=status-1')
    expect(query).toContain('prefix=QA')
    expect(query).toContain('field_fd-1_enum=high')
    expect(query).toContain('limit=40')
  })

  it('serializes portion params for GET /api/tasks/status/:id/portion', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        status_id: 'status-1',
        items: [],
        total: 0,
        offset: 0,
        limit: 50,
        next_offset: 0,
        has_more: false,
      },
    })
    const { tasksListStatusPortion } = await import('@/services/http/tasksApi')

    await tasksListStatusPortion(
      'status-1',
      {
        search: 'n',
        field_filters: [{ field_definition_id: 'fd-2', user_ids: ['u-1'] }],
      },
      30,
      20,
    )

    expect(getMock).toHaveBeenCalledTimes(1)
    const [url, config] = getMock.mock.calls[0]
    expect(url).toBe('/api/tasks/status/status-1/portion')
    const query = String((config.params as URLSearchParams).toString())
    expect(query).toContain('search=n')
    expect(query).toContain('field_fd-2_user=u-1')
    expect(query).toContain('offset=30')
    expect(query).toContain('limit=20')
  })
})
