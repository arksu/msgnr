import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '@/stores/tasks'
import { tasksUpdateTaskDescription } from '@/services/http/tasksApi'

vi.mock('@/services/http/tasksApi', () => ({
  tasksListTemplates: vi.fn(async () => []),
  tasksListStatuses: vi.fn(async () => []),
  tasksListFields: vi.fn(async () => []),
  tasksListUsers: vi.fn(async () => []),
  tasksGetDictionaryVersionItems: vi.fn(async () => []),
  tasksListDictionaryVersions: vi.fn(async () => []),
  tasksCreate: vi.fn(),
  tasksGet: vi.fn(),
  tasksUpdate: vi.fn(),
  tasksUpdateTaskTitle: vi.fn(),
  tasksUpdateTaskStatus: vi.fn(),
  tasksUpdateTaskDescription: vi.fn(),
  tasksUpdateTaskFieldValue: vi.fn(),
  tasksCreateSubtask: vi.fn(),
  tasksListTasks: vi.fn(async () => ({ groups: [], grand_total: 0 })),
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeTask(id: string, description: string) {
  return {
    id,
    title: id,
    description,
    template_id: 'template-1',
    status_id: 'status-1',
    field_values: [],
    subtasks: [],
    updated_at: '2026-03-17T00:00:00Z',
  } as any
}

describe('tasksStore.updateTaskDescription', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('updates selectedTask when response belongs to current task', async () => {
    const store = useTasksStore()
    store.selectedTask = makeTask('task-1', 'old')

    vi.mocked(tasksUpdateTaskDescription).mockResolvedValueOnce(makeTask('task-1', 'new markdown'))

    await store.updateTaskDescription('task-1', 'new markdown')

    expect(store.selectedTask?.id).toBe('task-1')
    expect(store.selectedTask?.description).toBe('new markdown')
  })

  it('ignores stale description response after navigation to another task', async () => {
    const store = useTasksStore()
    store.selectedTask = makeTask('task-1', 'old')

    const pending = deferred<any>()
    vi.mocked(tasksUpdateTaskDescription).mockReturnValueOnce(pending.promise)

    const inFlight = store.updateTaskDescription('task-1', 'new markdown')
    store.selectedTask = makeTask('task-2', 'second task')

    pending.resolve(makeTask('task-1', 'new markdown'))
    await inFlight

    expect(store.selectedTask?.id).toBe('task-2')
    expect(store.selectedTask?.description).toBe('second task')
  })
})
