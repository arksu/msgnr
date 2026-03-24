import { describe, expect, it } from 'vitest'
import { renderMessageBodyWithEntities } from '@/utils/renderMessageEntities'

describe('renderMessageBodyWithEntities', () => {
  it('renders user entities as interactive mention buttons', () => {
    const html = renderMessageBodyWithEntities('hello @Alice', [
      { kind: 'user', targetId: 'user-1', label: '@Alice', href: '', start: 6, end: 12 },
    ])

    expect(html).toContain('data-message-entity-kind="user"')
    expect(html).toContain('data-target-id="user-1"')
    expect(html).toContain('@Alice')
  })

  it('renders task entities as links and keeps plain text markdown-rendered', () => {
    const html = renderMessageBodyWithEntities('task: @DEV-1 Demo', [
      { kind: 'task', targetId: 'task-1', label: '@DEV-1 Demo', href: '/tasks/dev-1', start: 6, end: 17 },
    ])

    expect(html).toContain('href="/tasks/dev-1"')
    expect(html).toContain('data-message-entity-kind="task"')
    expect(html).toContain('task:')
  })

  it('renders inline fragments without paragraph wrappers around entities', () => {
    const html = renderMessageBodyWithEntities('before\n@Alice\nafter', [
      { kind: 'user', targetId: 'user-1', label: '@Alice', href: '', start: 7, end: 13 },
    ])

    expect(html).not.toContain('<p>')
    expect(html).toContain('<br>')
    expect(html).toContain('after')
  })
})
