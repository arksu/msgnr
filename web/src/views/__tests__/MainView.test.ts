import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { NotificationLevel, PresenceStatus } from '@/shared/proto/packets_pb'
import { useAuthStore } from '@/stores/auth'
import { useTasksStore } from '@/stores/tasks'
import { useDocumentsStore } from '@/stores/documents'
import { useWsStore } from '@/stores/ws'
import { useChatStore } from '@/stores/chat'
import { useCallStore } from '@/stores/call'
import { isUuidTaskRouteValue, taskSlugFromPublicId } from '@/services/taskRoute'
import { toNotificationOpenMessage } from '@/services/notificationOpen'
import MainView from '@/views/MainView.vue'

const orchestratorMocks = vi.hoisted(() => ({
  logout: vi.fn<() => Promise<void>>(),
}))

const taskRouteStorageMocks = vi.hoisted(() => ({
  loadLastOpenedTaskPublicId: vi.fn<() => string>(),
  saveLastOpenedTaskPublicId: vi.fn<(publicId: string) => void>(),
  clearLastOpenedTaskPublicId: vi.fn<() => void>(),
}))

vi.mock('@/composables/useSessionOrchestrator', () => ({
  useSessionOrchestrator: () => ({
    logout: orchestratorMocks.logout,
  }),
}))

vi.mock('@/services/sound', () => ({
  useNotificationSoundEngine: () => ({
    playMessagePing: vi.fn().mockResolvedValue(undefined),
    startCallInviteRing: vi.fn().mockResolvedValue(undefined),
    stopCallInviteRing: vi.fn(),
  }),
}))

vi.mock('@/services/storage/lastTaskRouteStorage', () => ({
  loadLastOpenedTaskPublicId: taskRouteStorageMocks.loadLastOpenedTaskPublicId,
  saveLastOpenedTaskPublicId: taskRouteStorageMocks.saveLastOpenedTaskPublicId,
  clearLastOpenedTaskPublicId: taskRouteStorageMocks.clearLastOpenedTaskPublicId,
}))

vi.mock('@/components/AppSidebar.vue', () => ({
  default: {
    template: '<aside data-testid="sidebar" />',
  },
}))

vi.mock('@/components/ResizableSidebar.vue', () => ({
  default: {
    template: '<div data-testid="resizable-sidebar"><slot /></div>',
  },
}))

vi.mock('@/components/ChatArea.vue', () => ({
  default: {
    template: '<section data-testid="chat-area" />',
  },
}))

vi.mock('@/components/UnreadFeedPane.vue', () => ({
  default: {
    props: [],
    emits: ['open-item'],
    template: '<section data-testid="unread-feed"><button data-testid="unread-feed-open" @click="$emit(\'open-item\', { id: \'thread:notif-1\', notificationId: \'notif-1\', conversationId: \'dm-1\', kind: \'thread\', messageId: \'msg-1\', threadRootMessageId: \'root-1\' })">open</button></section>',
  },
}))

vi.mock('@/components/tasks/TaskTrackerShell.vue', () => ({
  __isTeleport: false,
  default: {
    props: ['modelValue', 'currentView', 'viewMode'],
    emits: ['update:modelValue', 'openList', 'openKanban', 'openTask', 'back'],
    template: `
      <div data-testid="task-tracker">
        <aside data-testid="task-tracker-sidebar" />
        <section v-if="viewMode === 'card'" data-testid="task-card">
          <button data-testid="task-card-back" @click="$emit('back')">back</button>
        </section>
        <section v-else-if="viewMode === 'kanban'" data-testid="task-kanban-view">
          <button data-testid="task-kanban-open" @click="$emit('openTask', 'TASK-K')">open</button>
        </section>
        <section v-else data-testid="task-list-view">
          <button data-testid="task-list-open" @click="$emit('openTask', 'TASK-1')">open</button>
        </section>
        <div data-testid="task-create-dialog" />
      </div>
    `,
  },
}))

vi.mock('@/components/tasks/TaskTrackerSidebar.vue', () => ({
  default: {
    props: ['modelValue', 'currentView'],
    emits: ['update:modelValue', 'openList', 'openKanban'],
    template: '<aside data-testid="task-tracker-sidebar" />',
  },
}))

vi.mock('@/components/tasks/TaskListView.vue', () => ({
  default: {
    emits: ['openTask'],
    template: '<section data-testid="task-list-view"><button data-testid="task-list-open" @click="$emit(\'openTask\', \'TASK-1\')">open</button></section>',
  },
}))

vi.mock('@/components/tasks/TaskKanbanView.vue', () => ({
  default: {
    emits: ['openTask'],
    template: '<section data-testid="task-kanban-view"><button data-testid="task-kanban-open" @click="$emit(\'openTask\', \'TASK-K\')">open</button></section>',
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

vi.mock('@/components/documents/DocumentsSidebar.vue', () => ({
  default: {
    props: ['selectedTeamspaceId', 'selectedDocumentId'],
    emits: ['openTeamspaces', 'openTeamspace', 'openDocument'],
    template: '<aside data-testid="documents-sidebar" />',
  },
}))

vi.mock('@/components/documents/DocumentsShell.vue', () => ({
  __isTeleport: false,
  default: {
    props: ['selectedTeamspaceId', 'selectedDocumentId', 'viewMode'],
    emits: ['openTeamspaces', 'openTeamspace', 'openDocument', 'documentsDeleted', 'back', 'openParent'],
    template: `
      <div data-testid="documents-mode">
        <aside data-testid="documents-sidebar" />
        <section v-if="viewMode === 'card'" data-testid="document-card">
          <button data-testid="document-card-back" @click="$emit('back')">back</button>
        </section>
        <section v-else data-testid="teamspaces-view" />
      </div>
    `,
  },
}))

vi.mock('@/components/documents/TeamspacesView.vue', () => ({
  default: {
    props: ['selectedTeamspaceId'],
    emits: ['openTeamspace'],
    template: '<section data-testid="teamspaces-view" />',
  },
}))

vi.mock('@/components/documents/DocumentCard.vue', () => ({
  default: {
    emits: ['back', 'openParent'],
    template: '<section data-testid="document-card"><button data-testid="document-card-back" @click="$emit(\'back\')">back</button></section>',
  },
}))

function createMainRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'main', component: MainView },
      { path: '/tasks', name: 'tasks-list', component: MainView },
      { path: '/tasks/kanban', name: 'tasks-kanban', component: MainView },
      {
        path: '/tasks/:taskSlug',
        name: 'tasks-card',
        component: MainView,
        beforeEnter: (to) => {
          const taskSlug = typeof to.params.taskSlug === 'string' ? to.params.taskSlug : ''
          if (!taskSlug || isUuidTaskRouteValue(taskSlug)) {
            return { name: 'tasks-list' }
          }

          const canonicalTaskSlug = taskSlugFromPublicId(taskSlug)
          if (taskSlug !== canonicalTaskSlug) {
            return {
              name: 'tasks-card',
              params: { taskSlug: canonicalTaskSlug },
              query: to.query,
              hash: to.hash,
              replace: true,
            }
          }

          return true
        },
      },
      { path: '/documents', name: 'documents-teamspaces', component: MainView },
      { path: '/documents/teamspaces/:teamspaceId', name: 'documents-teamspace', component: MainView },
      { path: '/documents/:documentId', name: 'documents-card', component: MainView },
      { path: '/login', name: 'login', component: { template: '<div>login</div>' } },
    ],
  })
}

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

async function flushAsyncWork(cycles = 4) {
  for (let i = 0; i < cycles; i += 1) {
    await flushUi()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function mountAtRoute(router: ReturnType<typeof createMainRouter>) {
  return mount(
    { template: '<router-view />' },
    { global: { plugins: [pinia, router] } },
  )
}

function createServiceWorkerContainerMock() {
  const listeners = new Set<(event: MessageEvent) => void>()
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type !== 'message' || typeof listener !== 'function') return
      listeners.add(listener as (event: MessageEvent) => void)
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type !== 'message' || typeof listener !== 'function') return
      listeners.delete(listener as (event: MessageEvent) => void)
    },
    dispatchMessage(data: unknown) {
      const event = { data } as MessageEvent
      for (const listener of listeners) listener(event)
    },
  }
}

let pinia: Pinia
let serviceWorkerContainerMock: ReturnType<typeof createServiceWorkerContainerMock>

describe('MainView server unavailable state', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    serviceWorkerContainerMock = createServiceWorkerContainerMock()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorkerContainerMock,
    })
    orchestratorMocks.logout.mockReset()
    orchestratorMocks.logout.mockResolvedValue()
    taskRouteStorageMocks.loadLastOpenedTaskPublicId.mockReset()
    taskRouteStorageMocks.loadLastOpenedTaskPublicId.mockReturnValue('')
    taskRouteStorageMocks.saveLastOpenedTaskPublicId.mockReset()
    taskRouteStorageMocks.clearLastOpenedTaskPublicId.mockReset()

    const tasksStore = useTasksStore(pinia)
    vi.spyOn(tasksStore, 'selectTask').mockImplementation(async (id: string) => {
      tasksStore.selectedTask = { id, public_id: id.toUpperCase() } as any
    })
    vi.spyOn(tasksStore, 'selectTaskByPublicId').mockImplementation(async (publicId: string) => {
      tasksStore.selectedTask = { id: `uuid-for-${publicId}`, public_id: publicId } as any
    })
    vi.spyOn(tasksStore, 'loadTaskList').mockResolvedValue()

    const documentsStore = useDocumentsStore(pinia)
    vi.spyOn(documentsStore, 'selectDocument').mockImplementation(async (id: string) => {
      documentsStore.selectedDocument = { id, teamspace_id: 'teamspace-1' } as any
    })
    vi.spyOn(documentsStore, 'clearSelectedDocument').mockImplementation(() => {
      documentsStore.selectedDocument = null
    })
    vi.spyOn(documentsStore, 'loadTeamspaces').mockResolvedValue()
    vi.spyOn(documentsStore, 'loadSidebar').mockResolvedValue()
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

  it('opens the notified conversation from a service worker message without reloading the app shell', async () => {
    const router = createMainRouter()
    router.push('/tasks')
    await router.isReady()

    const authStore = useAuthStore()
    authStore.authState = 'AUTHENTICATED'
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    const chatStore = useChatStore()
    chatStore.bootstrapped = true
    chatStore.directMessages = [{
      id: 'dm-1',
      userId: 'user-2',
      displayName: 'Bob',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }] as any
    const requestConversationComposerFocusSpy = vi.spyOn(chatStore, 'requestConversationComposerFocus')
    vi.spyOn(chatStore, 'selectChannel').mockImplementation(async (conversationId: string) => {
      chatStore.activeChannelId = conversationId
    })

    mountAtRoute(router)
    await flushUi()

    serviceWorkerContainerMock.dispatchMessage(toNotificationOpenMessage({
      conversationId: 'dm-1',
      messageId: 'msg-1',
      url: '/',
    }))
    await flushAsyncWork()

    expect(router.currentRoute.value.name).toBe('main')
    expect(chatStore.activeChannelId).toBe('dm-1')
    expect(requestConversationComposerFocusSpy).toHaveBeenCalled()
  })

  it('consumes cold-start notification query params after bootstrap and clears them', async () => {
    const router = createMainRouter()
    router.push({ path: '/', query: { notificationOpen: '1', conversationId: 'dm-1', messageId: 'msg-1' } })
    await router.isReady()

    const authStore = useAuthStore()
    authStore.authState = 'AUTHENTICATED'
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    const chatStore = useChatStore()
    chatStore.bootstrapped = true
    chatStore.directMessages = [{
      id: 'dm-1',
      userId: 'user-2',
      displayName: 'Bob',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }] as any
    vi.spyOn(chatStore, 'selectChannel').mockImplementation(async (conversationId: string) => {
      chatStore.activeChannelId = conversationId
    })

    mountAtRoute(router)
    await flushAsyncWork()

    expect(chatStore.activeChannelId).toBe('dm-1')
    expect(router.currentRoute.value.query.notificationOpen).toBeUndefined()
    expect(router.currentRoute.value.query.conversationId).toBeUndefined()
    expect(router.currentRoute.value.query.messageId).toBeUndefined()
  })

  it('defers cold-start notification open until chat bootstrap is live', async () => {
    const router = createMainRouter()
    router.push({ path: '/', query: { notificationOpen: '1', conversationId: 'dm-1' } })
    await router.isReady()

    const authStore = useAuthStore()
    authStore.authState = 'AUTHENTICATED'
    const wsStore = useWsStore()
    wsStore.state = 'BOOTSTRAPPING'
    const chatStore = useChatStore()
    chatStore.bootstrapped = false
    const selectChannelSpy = vi.spyOn(chatStore, 'selectChannel').mockImplementation(async (conversationId: string) => {
      chatStore.activeChannelId = conversationId
    })

    mountAtRoute(router)
    await flushUi()

    expect(selectChannelSpy).not.toHaveBeenCalled()
    expect(chatStore.activeChannelId).toBe('')

    chatStore.directMessages = [{
      id: 'dm-1',
      userId: 'user-2',
      displayName: 'Bob',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }] as any
    chatStore.bootstrapped = true
    wsStore.state = 'LIVE_SYNCED'
    await flushAsyncWork()

    expect(chatStore.activeChannelId).toBe('dm-1')
    expect(router.currentRoute.value.query.notificationOpen).toBeUndefined()
  })

  it('hides chat mode unread badge while chat mode is active', async () => {
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const chatStore = useChatStore()
    chatStore.channels = [{
      id: 'channel-1',
      name: 'General',
      kind: 'channel',
      visibility: 'public',
      unread: 4,
      notificationLevel: NotificationLevel.ALL,
    }] as any

    const wrapper = mountAtRoute(router)
    await flushUi()

    expect(wrapper.find('[data-testid="mode-chat-unread-badge"]').exists()).toBe(false)
  })

  it('shows chat mode unread badge in task tracker mode when unread exists', async () => {
    const router = createMainRouter()
    router.push('/tasks')
    await router.isReady()

    const chatStore = useChatStore()
    chatStore.unreadFeedTotalCount = 7 as any

    const wrapper = mountAtRoute(router)
    await flushUi()

    const badge = wrapper.find('[data-testid="mode-chat-unread-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('7')
  })

  it('caps chat mode unread badge text at 99+', async () => {
    const router = createMainRouter()
    router.push('/tasks')
    await router.isReady()

    const chatStore = useChatStore()
    chatStore.unreadFeedTotalCount = 120 as any

    const wrapper = mountAtRoute(router)
    await flushUi()

    const badge = wrapper.find('[data-testid="mode-chat-unread-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('99+')
  })

  it('does not render chat mode unread badge in task tracker mode when unread is zero', async () => {
    const router = createMainRouter()
    router.push('/tasks')
    await router.isReady()

    const chatStore = useChatStore()
    chatStore.channels = [{
      id: 'channel-1',
      name: 'General',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }] as any

    const wrapper = mountAtRoute(router)
    await flushUi()

    expect(wrapper.find('[data-testid="mode-chat-unread-badge"]').exists()).toBe(false)
  })

  it('opens remembered task route when task tracker button is clicked', async () => {
    taskRouteStorageMocks.loadLastOpenedTaskPublicId.mockReturnValue('TASK-REMEMBERED')
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const wrapper = mountAtRoute(router)

    await (wrapper.findComponent(MainView).vm as any).goToTaskTrackerMode()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-card')
    expect(router.currentRoute.value.params.taskSlug).toBe('task-remembered')
    expect(wrapper.find('[data-testid=\"task-card\"]').exists()).toBe(true)
  })

  it('opens documents route when documents button is clicked', async () => {
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const wrapper = mountAtRoute(router)

    await (wrapper.findComponent(MainView).vm as any).goToDocumentsMode()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('documents-teamspaces')
    expect(wrapper.find('[data-testid="documents-mode"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="documents-sidebar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="teamspaces-view"]').exists()).toBe(true)
  })

  it('returns to the documents browser from a teamspace route', async () => {
    const router = createMainRouter()
    router.push('/documents/teamspaces/teamspace-1')
    await router.isReady()

    const wrapper = mountAtRoute(router)
    await flushUi()

    const documentsStore = useDocumentsStore(pinia)
    await router.push({ name: 'documents-teamspaces' })
    await flushUi()

    expect(router.currentRoute.value.name).toBe('documents-teamspaces')
    expect(documentsStore.selectedDocument).toBeNull()
  })

  it('keeps documents card mode and loads document on direct /documents/:documentId entry', async () => {
    const router = createMainRouter()
    const documentsStore = useDocumentsStore(pinia)
    const selectDocumentSpy = vi.spyOn(documentsStore, 'selectDocument')
    router.push('/documents/document-123')
    await router.isReady()

    const wrapper = mountAtRoute(router)
    await flushUi()

    expect(router.currentRoute.value.name).toBe('documents-card')
    expect(wrapper.find('[data-testid="document-card"]').exists()).toBe(true)
    expect(selectDocumentSpy).toHaveBeenCalledWith('document-123', true)
  })

  it('keeps task card mode and loads task on direct /tasks/:taskSlug entry', async () => {
    const router = createMainRouter()
    const tasksStore = useTasksStore(pinia)
    const selectTaskByPublicIdSpy = vi.spyOn(tasksStore, 'selectTaskByPublicId')
    router.push('/tasks/dev-123')
    await router.isReady()

    const wrapper = mountAtRoute(router)
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-card')
    expect(wrapper.find('[data-testid=\"task-card\"]').exists()).toBe(true)
    expect(selectTaskByPublicIdSpy).toHaveBeenCalledWith('DEV-123', true)
  })

  it('normalizes mixed-case task slugs to lowercase', async () => {
    const router = createMainRouter()
    router.push('/tasks/DEV-123')
    await router.isReady()

    mountAtRoute(router)
    await flushUi()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-card')
    expect(router.currentRoute.value.params.taskSlug).toBe('dev-123')
  })

  it('falls back to the list for legacy UUID task routes', async () => {
    const router = createMainRouter()
    const tasksStore = useTasksStore(pinia)
    const selectTaskByPublicIdSpy = vi.spyOn(tasksStore, 'selectTaskByPublicId')
    router.push('/tasks/92f41023-40a9-42f7-a124-38d426e061ba')
    await router.isReady()

    mountAtRoute(router)
    await flushUi()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-list')
    expect(selectTaskByPublicIdSpy).not.toHaveBeenCalled()
  })

  it('ignores remembered legacy UUID task routes', async () => {
    taskRouteStorageMocks.loadLastOpenedTaskPublicId.mockReturnValue('')
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const wrapper = mountAtRoute(router)

    await (wrapper.findComponent(MainView).vm as any).goToTaskTrackerMode()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-list')
  })

  it('accepts incoming invites by joining existing call without create-call step', async () => {
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const chatStore = useChatStore()
    const wsStore = useWsStore()
    const callStore = useCallStore()
    const startOrJoinSpy = vi.spyOn(callStore, 'startOrJoinCall').mockResolvedValue()
    const acceptInviteSpy = vi.spyOn(wsStore, 'sendAcceptCallInvite')
    chatStore.pendingInvites = [{
      id: 'invite-1',
      callId: 'call-1',
      conversationId: 'external-conversation-1',
      inviterUserId: 'user-2',
      state: 'created',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }]

    const wrapper = mountAtRoute(router)
    await flushUi()

    const acceptButton = wrapper.findAll('button').find(btn => btn.text().includes('Accept'))
    expect(acceptButton).toBeDefined()
    await acceptButton!.trigger('click')
    await flushUi()

    expect(acceptInviteSpy).toHaveBeenCalledWith('invite-1')
    expect(startOrJoinSpy).toHaveBeenCalledWith({
      conversationId: 'external-conversation-1',
      kind: 'channel',
      visibility: 'public',
      joinExistingOnly: true,
    })
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

  it('returns to kanban after opening card from kanban route', async () => {
    const router = createMainRouter()
    router.push('/tasks/kanban')
    await router.isReady()

    const wrapper = mountAtRoute(router)
    await flushUi()

    expect(wrapper.find('[data-testid="task-kanban-view"]').exists()).toBe(true)

    await (wrapper.findComponent(MainView).vm as any).openTask('TASK-K')
    await flushUi()
    expect(router.currentRoute.value.name).toBe('tasks-card')
    expect(router.currentRoute.value.params.taskSlug).toBe('task-k')

    await (wrapper.findComponent(MainView).vm as any).backToList()
    await flushUi()

    expect(router.currentRoute.value.name).toBe('tasks-kanban')
  })

  it('renders unread feed in chat mode and opens exact targets from unread items', async () => {
    const router = createMainRouter()
    router.push('/')
    await router.isReady()

    const authStore = useAuthStore()
    authStore.authState = 'AUTHENTICATED'
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    const chatStore = useChatStore()
    chatStore.bootstrapped = true
    chatStore.chatViewMode = 'unread' as any
    chatStore.directMessages = [{
      id: 'dm-1',
      userId: 'user-2',
      displayName: 'Bob',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }] as any
    chatStore.messages = {
      'dm-1': [{
        id: 'root-1',
        channelId: 'dm-1',
        senderId: 'user-2',
        senderName: 'Bob',
        body: 'root',
        channelSeq: 1n,
        threadSeq: 0n,
        mentionedUserIds: [],
        mentionEveryone: false,
        createdAt: new Date().toISOString(),
        reactions: [],
        myReactions: [],
      }],
    } as any
    vi.spyOn(chatStore, 'ensureConversationHistory').mockResolvedValue(undefined)
    vi.spyOn(chatStore, 'loadMessageContext').mockResolvedValue('loaded')
    const markUnreadFeedItemReadSpy = vi.spyOn(chatStore, 'markUnreadFeedItemRead').mockResolvedValue(undefined)
    const openThreadSpy = vi.spyOn(chatStore, 'openThread')

    const wrapper = mountAtRoute(router)
    await flushUi()

    expect(wrapper.find('[data-testid="unread-feed"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-area"]').exists()).toBe(false)

    await wrapper.get('[data-testid="unread-feed-open"]').trigger('click')
    await flushAsyncWork()

    expect(chatStore.activeChannelId).toBe('dm-1')
    expect(chatStore.chatViewMode).toBe('conversation')
    expect(chatStore.focusedMessageId).toBe('root-1')
    expect(chatStore.focusedThreadMessageId).toBe('msg-1')
    expect(openThreadSpy).toHaveBeenCalled()
    expect(chatStore.threadComposerFocusToken).toBeGreaterThan(0)
    expect(markUnreadFeedItemReadSpy).toHaveBeenCalledWith(expect.objectContaining({
      notificationId: 'notif-1',
      conversationId: 'dm-1',
    }))
  })
})
