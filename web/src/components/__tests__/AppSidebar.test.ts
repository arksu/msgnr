import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { nextTick } from 'vue'
import { NotificationLevel, PresenceStatus } from '@/shared/proto/packets_pb'
import AppSidebar from '@/components/AppSidebar.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'

const chatApiMocks = vi.hoisted(() => ({
  listDmCandidates: vi.fn(),
  createOrOpenDm: vi.fn(),
  listAvailableChannels: vi.fn(),
  joinChannels: vi.fn(),
  leaveConversation: vi.fn(),
}))

vi.mock('@/services/http/chatApi', () => ({
  listDmCandidates: chatApiMocks.listDmCandidates,
  createOrOpenDm: chatApiMocks.createOrOpenDm,
  listAvailableChannels: chatApiMocks.listAvailableChannels,
  joinChannels: chatApiMocks.joinChannels,
  leaveConversation: chatApiMocks.leaveConversation,
}))

vi.mock('@/composables/useSessionOrchestrator', () => ({
  useSessionOrchestrator: () => ({
    logout: vi.fn(),
  }),
}))

async function flushAll() {
  await Promise.resolve()
  await nextTick()
}

describe('AppSidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chatApiMocks.listDmCandidates.mockResolvedValue([
      { user_id: 'user-2', display_name: 'Bob', email: 'bob@example.com', avatar_url: '' },
    ])
    chatApiMocks.createOrOpenDm.mockResolvedValue({
      conversation_id: 'dm-1',
      user_id: 'user-2',
      display_name: 'Bob',
      email: 'bob@example.com',
      avatar_url: '',
      kind: 'dm',
      visibility: 'dm',
    })
    chatApiMocks.listAvailableChannels.mockResolvedValue([
      { id: 'channel-1', name: 'General', kind: 'channel', visibility: 'public', last_activity_at: '2026-03-06T00:00:00Z' },
      { id: 'channel-2', name: 'Random', kind: 'channel', visibility: 'public', last_activity_at: '2026-03-06T00:00:00Z' },
    ])
    chatApiMocks.joinChannels.mockResolvedValue([
      { id: 'channel-1', name: 'General', kind: 'channel', visibility: 'public', last_activity_at: '2026-03-06T00:00:00Z' },
      { id: 'channel-2', name: 'Random', kind: 'channel', visibility: 'public', last_activity_at: '2026-03-06T00:00:00Z' },
    ])
    chatApiMocks.leaveConversation.mockResolvedValue(undefined)
  })

  it('shows email fallback in DM picker and opened DM when display name is empty', async () => {
    chatApiMocks.listDmCandidates.mockResolvedValue([
      { user_id: 'user-3', display_name: '', email: 'eve@example.com', avatar_url: '' },
    ])
    chatApiMocks.createOrOpenDm.mockResolvedValue({
      conversation_id: 'dm-2',
      user_id: 'user-3',
      display_name: '',
      email: 'eve@example.com',
      avatar_url: '',
      kind: 'dm',
      visibility: 'dm',
    })

    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    await wrapper.get('[data-testid="new-message-button"]').trigger('click')
    await flushAll()

    expect(wrapper.text()).toContain('eve@example.com')

    await wrapper.get('[data-testid="dm-candidate-user-3"]').trigger('click')
    await flushAll()

    expect(chatStore.directMessages).toEqual([
      {
        id: 'dm-2',
        userId: 'user-3',
        displayName: 'eve@example.com',
        avatarUrl: '',
        presence: 'offline',
        unread: 0,
        notificationLevel: NotificationLevel.ALL,
      },
    ])
  })

  it('opens the dm picker and selects a created direct message', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    await wrapper.get('[data-testid="new-message-button"]').trigger('click')
    await flushAll()

    expect(chatApiMocks.listDmCandidates).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Bob')

    await wrapper.get('[data-testid="dm-candidate-user-2"]').trigger('click')
    await flushAll()

    expect(chatApiMocks.createOrOpenDm).toHaveBeenCalledWith('user-2')
    expect(chatStore.directMessages).toEqual([
      {
        id: 'dm-1',
        userId: 'user-2',
        displayName: 'Bob',
        avatarUrl: '',
        presence: 'offline',
        unread: 0,
        notificationLevel: NotificationLevel.ALL,
      },
    ])
    expect(chatStore.activeChannelId).toBe('dm-1')
  })

  it('hides users that already have an opened dm from the dm picker', async () => {
    chatApiMocks.listDmCandidates.mockResolvedValue([
      { user_id: 'user-2', display_name: 'Bob', email: 'bob@example.com', avatar_url: '' },
      { user_id: 'user-3', display_name: 'Eve', email: 'eve@example.com', avatar_url: '' },
    ])

    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chatStore.directMessages = [
      {
        id: 'dm-1',
        userId: 'user-2',
        displayName: 'Bob',
        avatarUrl: '',
        presence: 'offline',
        unread: 0,
        notificationLevel: NotificationLevel.ALL,
      },
    ]

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    await wrapper.get('[data-testid="new-message-button"]').trigger('click')
    await flushAll()

    expect(wrapper.find('[data-testid="dm-candidate-user-2"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="dm-candidate-user-3"]').exists()).toBe(true)
  })

  it('joins multiple channels and opens the first in dialog list order', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    await wrapper.get('[data-testid="add-channel-button"]').trigger('click')
    await flushAll()

    await wrapper.get('[data-testid="channel-candidate-channel-2"]').trigger('click')
    await wrapper.get('[data-testid="channel-candidate-channel-1"]').trigger('click')
    await wrapper.get('[data-testid="join-selected-channels-button"]').trigger('click')
    await flushAll()

    expect(chatApiMocks.joinChannels).toHaveBeenCalledWith(['channel-1', 'channel-2'])
    expect(chatStore.activeChannelId).toBe('channel-1')
    expect(chatStore.channels.map(channel => channel.id)).toEqual(['channel-2', 'channel-1'])
  })

  it('renders channel list in alphabetical order', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chatStore.channels = [
      { id: 'c2', name: 'zulu', kind: 'channel', visibility: 'public', unread: 0, notificationLevel: NotificationLevel.ALL },
      { id: 'c1', name: 'Alpha', kind: 'channel', visibility: 'public', unread: 0, notificationLevel: NotificationLevel.ALL },
    ]

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    const text = wrapper.text()
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('zulu'))
  })

  it('shows lock icon for private channels', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chatStore.channels = [
      { id: 'private-1', name: 'Secret', kind: 'channel', visibility: 'private', unread: 0, notificationLevel: NotificationLevel.ALL },
    ]

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    expect(wrapper.find('[data-testid="channel-private-icon-private-1"]').exists()).toBe(true)
  })

  it('shows active call icon for a channel conversation', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chatStore.channels = [
      { id: 'channel-1', name: 'General', kind: 'channel', visibility: 'public', unread: 0, notificationLevel: NotificationLevel.ALL },
    ]
    chatStore.activeCalls = [
      { id: 'call-1', conversationId: 'channel-1', status: '1', participantCount: 2 },
    ]

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    expect(wrapper.find('[data-testid="active-call-icon-channel-channel-1"]').exists()).toBe(true)
  })

  it('shows and hides active call icon for a DM conversation from activeCalls updates', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chatStore.directMessages = [
      { id: 'dm-1', userId: 'user-2', displayName: 'Bob', presence: 'online', unread: 0, notificationLevel: NotificationLevel.ALL },
    ]
    chatStore.activeCalls = [
      { id: 'call-1', conversationId: 'dm-1', status: '1', participantCount: 2 },
    ]

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    expect(wrapper.find('[data-testid="active-call-icon-dm-dm-1"]').exists()).toBe(true)

    chatStore.activeCalls = []
    await flushAll()
    expect(wrapper.find('[data-testid="active-call-icon-dm-dm-1"]').exists()).toBe(false)
  })

  it('navigates from admin page to main when selecting a conversation', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'admin'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'admin',
    }
    chatStore.channels = [
      { id: 'channel-1', name: 'General', kind: 'channel', visibility: 'public', unread: 0, notificationLevel: NotificationLevel.ALL },
    ]

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'main', component: { template: '<div />' } },
        { path: '/admin', name: 'admin', component: { template: '<div />' } },
      ],
    })
    await router.push('/admin')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    const channelButton = wrapper.findAll('button.sidebar-item').find(button => button.text().includes('General'))
    expect(channelButton).toBeTruthy()
    await channelButton!.trigger('click')
    await flushAll()

    expect(chatStore.activeChannelId).toBe('channel-1')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('main')
    })
  })

  it('sends manual away presence from sidebar user block', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const wsStore = useWsStore()
    wsStore.state = 'LIVE_SYNCED'
    const sendSetPresenceSpy = vi.spyOn(wsStore, 'sendSetPresence')

    authStore.user = {
      id: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
      role: 'member',
    }
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    await wrapper.get('[data-testid="presence-menu-button"]').trigger('click')
    await wrapper.get('[data-testid="presence-set-away"]').trigger('click')

    expect(sendSetPresenceSpy).toHaveBeenCalledWith(PresenceStatus.AWAY)
    expect(localStorage.getItem('msgnr:manual-presence')).toBe('away')
  })

  it('leaves selected channel via conversation menu', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    authStore.sessionRole = 'member'
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfRole: 'member',
    }
    chatStore.channels = [
      { id: 'channel-1', name: 'General', kind: 'channel', visibility: 'public', unread: 0, notificationLevel: NotificationLevel.ALL },
    ]
    chatStore.activeChannelId = 'channel-1'

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [router],
        stubs: {
          SidebarItem: {
            template: '<button class="sidebar-item" @click="$emit(\'click\')"><slot name="icon" /><slot /><slot name="actions" /></button>',
          },
          RouterLink: {
            template: '<a><slot /></a>',
          },
          Teleport: true,
        },
      },
    })

    await wrapper.get('[data-testid="conversation-menu-button-channel-channel-1"]').trigger('click')
    await wrapper.get('[data-testid="conversation-leave-channel-channel-1"]').trigger('click')
    await flushAll()

    expect(chatApiMocks.leaveConversation).toHaveBeenCalledWith('channel-1')
    expect(chatStore.channels).toEqual([])
    expect(chatStore.activeChannelId).toBe('')
  })
})
