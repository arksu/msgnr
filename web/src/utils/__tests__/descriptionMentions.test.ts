import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tasksListTasks, tasksListUsers } from '@/services/http/tasksApi'
import {
  buildTaskMentionHref,
  buildUserMentionHref,
  decorateDescriptionMentionAnchors,
  decorateDescriptionMentionHtml,
  parseUserMentionHref,
  resetDescriptionMentionCacheForTests,
  searchDescriptionMentionSuggestions,
} from '@/utils/descriptionMentions'

vi.mock('@/services/http/tasksApi', () => ({
  tasksListUsers: vi.fn(),
  tasksListTasks: vi.fn(),
}))

describe('descriptionMentions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDescriptionMentionCacheForTests()
    vi.mocked(tasksListUsers).mockResolvedValue([
      {
        id: 'user-1',
        display_name: 'Alice Example',
        email: 'alice@example.com',
        avatar_url: 'https://example.com/alice.png',
      },
      {
        id: 'user-2',
        display_name: 'Bob Example',
        email: 'bob@example.com',
      },
    ])
    vi.mocked(tasksListTasks).mockResolvedValue({
      groups: [
        {
          status: { id: 'status-1', code: 'todo', name: 'Todo', sort_order: 1 },
          tasks: [
            {
              id: 'task-1',
              public_id: 'TASK-123',
              title: 'Fix search',
              template_id: 'tpl-1',
              template_snapshot_prefix: 'TASK',
              status_id: 'status-1',
              created_at: '2026-04-08T00:00:00Z',
              updated_at: '2026-04-08T00:00:00Z',
            },
          ],
          total: 1,
          page: 1,
          page_size: 10,
        },
      ],
      grand_total: 1,
    })
  })

  it('builds and parses user mention hrefs', () => {
    const href = buildUserMentionHref('user-1')

    expect(href).toBe('msgnr-mention://user/user-1')
    expect(parseUserMentionHref(href)).toEqual({ userId: 'user-1' })
  })

  it('returns filtered user suggestions and task suggestions', async () => {
    const results = await searchDescriptionMentionSuggestions('ali')

    expect(results[0]).toMatchObject({
      kind: 'user',
      id: 'user-1',
      label: '@Alice Example',
      href: 'msgnr-mention://user/user-1',
    })
    expect(results).toContainEqual(expect.objectContaining({
      kind: 'task',
      id: 'task-1',
      label: '@TASK-123 Fix search',
      href: buildTaskMentionHref('TASK-123'),
    }))
    expect(tasksListTasks).toHaveBeenCalledWith(expect.objectContaining({
      search: 'ali',
      include_subtasks: true,
    }))
  })

  it('decorates rendered user and task mention anchors', () => {
    const root = document.createElement('div')
    root.innerHTML = [
      '<a href="msgnr-mention://user/user-1">@Alice Example</a>',
      '<a href="/tasks/task-123">@TASK-123 Fix search</a>',
    ].join('')

    decorateDescriptionMentionAnchors(root)

    const anchors = root.querySelectorAll('a')
    expect(anchors[0].dataset.descriptionMentionKind).toBe('user')
    expect(anchors[0].dataset.userId).toBe('user-1')
    expect(anchors[0].className).toContain('mention-link')
    expect(anchors[1].dataset.descriptionMentionKind).toBe('task')
    expect(anchors[1].className).toContain('mention-link')
  })

  it('decorates mention html strings', () => {
    const html = decorateDescriptionMentionHtml('<p><a href="msgnr-mention://user/user-1">@Alice Example</a></p>')

    expect(html).toContain('data-description-mention-kind="user"')
    expect(html).toContain('mention-link')
  })
})
