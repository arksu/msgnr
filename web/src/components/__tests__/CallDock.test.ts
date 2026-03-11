import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { NotificationLevel } from '@/shared/proto/packets_pb'
import CallDock from '@/components/CallDock.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useCallStore } from '@/stores/call'

const chatApiMocks = vi.hoisted(() => ({
  listConversationMembers: vi.fn(),
}))

vi.mock('@/services/http/chatApi', () => ({
  listConversationMembers: chatApiMocks.listConversationMembers,
}))

async function flushAll() {
  await Promise.resolve()
  await nextTick()
}

describe('CallDock invite modal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads candidates and sends invite request from the call window', async () => {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    const callStore = useCallStore()

    authStore.user = {
      id: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
      avatarUrl: '',
      role: 'member',
    }
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada',
      selfAvatarUrl: '',
      selfRole: 'member',
    }
    chatStore.channels = [{
      id: 'channel-1',
      name: 'general',
      kind: 'channel',
      visibility: 'public',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    }]

    callStore.connected = true
    callStore.minimized = false
    callStore.activeConversationId = 'channel-1'
    callStore.inviteMembersToActiveCall = vi.fn().mockResolvedValue({
      invitedUserIds: ['user-2'],
      skippedUserIds: ['user-3'],
    })

    chatApiMocks.listConversationMembers.mockResolvedValue([
      { user_id: 'user-1', display_name: 'Ada', email: 'ada@example.com', avatar_url: '' },
      { user_id: 'user-2', display_name: 'Bob', email: 'bob@example.com', avatar_url: '' },
      { user_id: 'user-3', display_name: 'Eve', email: 'eve@example.com', avatar_url: '' },
    ])

    const wrapper = mount(CallDock, {
      attachTo: document.body,
      global: {
        stubs: {
          UserAvatar: true,
        },
      },
    })

    await wrapper.get('[data-testid="calldock-invite-button"]').trigger('click')
    await flushAll()

    expect(chatApiMocks.listConversationMembers).toHaveBeenCalledWith('channel-1')
    const modal = document.body.querySelector('[data-testid="calldock-invite-modal"]') as HTMLElement | null
    expect(modal).not.toBeNull()
    const modalText = modal?.textContent ?? ''
    expect(modalText).toContain('Bob')
    expect(modalText).toContain('Eve')
    expect(modalText).not.toContain('ada@example.com')

    const candidate2 = document.body.querySelector('[data-testid="calldock-invite-candidate-user-2"]') as HTMLElement | null
    const candidate3 = document.body.querySelector('[data-testid="calldock-invite-candidate-user-3"]') as HTMLElement | null
    expect(candidate2).not.toBeNull()
    expect(candidate3).not.toBeNull()
    await candidate2?.click()
    await candidate3?.click()
    await flushAll()

    const sendInvitesButton = document.body.querySelector('[data-testid="calldock-send-invites"]') as HTMLElement | null
    expect(sendInvitesButton).not.toBeNull()
    await sendInvitesButton?.click()
    await flushAll()

    expect(callStore.inviteMembersToActiveCall).toHaveBeenCalledWith(['user-2', 'user-3'])
    const modalTextAfterSend = (document.body.querySelector('[data-testid="calldock-invite-modal"]') as HTMLElement | null)?.textContent ?? ''
    expect(modalTextAfterSend).toContain('Invited 1. Skipped 1.')
    expect(modalTextAfterSend).toContain('No members are available to invite.')

    wrapper.unmount()
  })
})
