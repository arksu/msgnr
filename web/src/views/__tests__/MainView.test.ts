import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { PresenceStatus } from '@/shared/proto/packets_pb'
import { useAuthStore } from '@/stores/auth'
import { useTasksStore } from '@/stores/tasks'
import { useWsStore } from '@/stores/ws'
import MainView from '@/views/MainView.vue'

const orchestratorMocks = vi.hoisted(() => ({
  logout: vi.fn<() => Promise<void>>(),
}))

const taskRouteStorageMocks = vi.hoisted(() => ({
  loadLastOpenedTaskId: vi.fn<() => string>(),
  saveLastOpenedTaskId: vi.fn<(taskId: string) => void>(),
  clearLastOpenedTaskId: vi.fn<() => void>(),
}))

vi.mock('@/composables/useSessionOrchestrator', () => ({
  useSessionOrchestrator: () => ({
    logout: orchestratorMocks.logout,
  }),
}))

vi.mock('@/services/storage/lastTaskRouteStorage', () => ({
  loadLastOpenedTaskId: taskRouteStorageMocks.loadLastOpenedTaskId,
  saveLastOpenedTaskId: taskRouteStorageMocks.saveLastOpenedTaskId,
  clearLastOpenedTaskId: taskRouteStorageMocks.clearLastOpenedTaskId,
}))

vi.mock('@/components/AppSidebar.vue', () => ({
  default: {
    template: '<aside data-testid="sidebar" />',
  },
}))

vi.mock('@/components/ChatArea.vue', () => ({
  default: {
    template: '<section data-testid="chat-area" />',
  },
}))

vi.mock('@/components/tasks/TaskTrackerSidebar.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<aside data-testid="task-tracker-sidebar" />',
  },
}))

vi.mock('@/components/tasks/TaskListView.vue', () => ({
  default: {
    emits: ['openTask'],
    template: '<section data-testid="task-list-view"><button data-testid="task-list-open" @click="$emit(\'openTask\', \'task-1\')">open</button></section>',
  },
}))

vi.mock('@/components/tasks/TaskCard.vue', () => ({
  default: {
    emits: ['back'],
    template: '<section data-testid="task-card"><button data-testid="task-card-back" @click="$emit(\'back\')">back</button></section>',
  },
}))

vi.mock('@/components/tasks/TaskCreateDialog.vue', () => ({
  default: {
    template: '<div data-testid="task-create-dialog" />',
  },
}))

function createMainRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'main', component: MainView },
      { path: '/tasks', name: 'tasks-list', component: MainView },
      { path: '/tasks/:taskId', name: 'tasks-card', component: MainView },
      { path: '/login', name: 'login', component: { template: '<div>login</div>' } },
    ],
  })
}

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountAtRoute(router: ReturnType<typeof createMainRouter>) {
  return mount(
    { template: '<router-view />' },
    { global: { plugins: [pinia, router] } },
  )
}

let pinia: Pinia

describe('MainView server unavailable state', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    orchestratorMocks.logout.mockReset()
    orchestratorMocks.logout.mockResolvedValue()
    taskRouteStorageMocks.loadLastOpenedTaskId.mockReset()
    taskRouteStorageMocks.loadLastOpenedTaskId.mockReturnValue('')
    taskRouteStorageMocks.saveLastOpenedTaskId.mockReset()
    taskRouteStorageMocks.clearLastOpenedTaskId.mockReset()

    const tasksStore = useTasksStore(pinia)
    vi.spyOn(tasksStore, 'selectTask').mockImplementation(async (id: string) => {
      tasksStore.selectedTask = { id } as any
    })
    vi.spyOn(tasksStore, 'loadTaskList').mockResolvedValue()
  })

  it('shows server unavailable alert with spinner and logout button', async () => {
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const authStore = useAuthStore()
    authStore.lastAuthError = 'Server is unavailable'

    const wrapper = mountAtRoute(router)

    expect(wrapper.text()).toContain('Server is unavailable')
    expect(wrapper.find('svg.animate-spin').exists()).toBe(true)
    expect(wrapper.find('[data-testid=\"server-unavailable-logout\"]').text()).toBe('Logout')
  })

  it('logs out and navigates to login when logout button is clicked', async () => {
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const authStore = useAuthStore()
    authStore.lastAuthError = 'Server is unavailable'
    const routerPushSpy = vi.spyOn(router, 'push')

    const wrapper = mountAtRoute(router)

    await wrapper.find('[data-testid=\"server-unavailable-logout\"]').trigger('click')
    await nextTick()

    expect(orchestratorMocks.logout).toHaveBeenCalledTimes(1)
    expect(routerPushSpy).toHaveBeenCalledWith({ name: 'login' })
  })

  it('applies stored manual away preference when auth completes', async () => {
    localStorage.setItem('msgnr:manual-presence', 'away')
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const wrapper = mountAtRoute(router)

    const wsStore = useWsStore()
    const sendSetPresenceSpy = vi.spyOn(wsStore, 'sendSetPresence')
    wsStore.state = 'AUTH_COMPLETE'
    await nextTick()

    expect(sendSetPresenceSpy).toHaveBeenCalledWith(PresenceStatus.AWAY)
    wrapper.unmount()
  })

  it('opens task list route when no remembered task exists', async () => {
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const wrapper = mountAtRoute(router)

    expect(wrapper.find('[data-testid=\"chat-area\"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=\"sidebar\"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=\"task-tracker\"]').exists()).toBe(false)

    await (wrapper.findComponent(MainView).vm as any).goToTaskTrackerMode()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-list')
    expect(wrapper.find('[data-testid=\"task-tracker\"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=\"task-list-view\"]').exists()).toBe(true)
  })

  it('opens remembered task route when task tracker button is clicked', async () => {
    taskRouteStorageMocks.loadLastOpenedTaskId.mockReturnValue('task-remembered')
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const wrapper = mountAtRoute(router)

    await (wrapper.findComponent(MainView).vm as any).goToTaskTrackerMode()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-card')
    expect(router.currentRoute.value.params.taskId).toBe('task-remembered')
    expect(wrapper.find('[data-testid=\"task-card\"]').exists()).toBe(true)
  })

  it('keeps task card mode and loads task on direct /tasks/:taskId entry', async () => {
    const router = createMainRouter()
    const tasksStore = useTasksStore(pinia)
    const selectTaskSpy = vi.spyOn(tasksStore, 'selectTask')
    router.push('/tasks/task-123')
    await router.isReady()

    const wrapper = mountAtRoute(router)
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-card')
    expect(wrapper.find('[data-testid=\"task-card\"]').exists()).toBe(true)
    expect(selectTaskSpy).toHaveBeenCalledWith('task-123', true)
  })

  it('navigates back to /tasks when card emits back', async () => {
    const router = createMainRouter()
    router.push('/tasks/task-555')
    await router.isReady()

    const wrapper = mountAtRoute(router)
    await flushUi()

    await (wrapper.findComponent(MainView).vm as any).backToList()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-list')
  })
})
