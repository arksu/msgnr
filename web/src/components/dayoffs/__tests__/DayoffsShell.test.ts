import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import DayoffDialog from '@/components/dayoffs/DayoffDialog.vue'
import DayoffsShell from '@/components/dayoffs/DayoffsShell.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useDayoffsStore } from '@/stores/dayoffs'
import { dayoffsList } from '@/services/http/dayoffsApi'

vi.mock('@/services/http/dayoffsApi', () => ({
  dayoffsCreate: vi.fn(),
  dayoffsDelete: vi.fn(),
  dayoffsList: vi.fn(),
  dayoffsUpdate: vi.fn(),
}))

function record(id: string, userId: string, startDate: string, endDate: string) {
  return {
    id,
    userId,
    type: 'vacation' as const,
    startDate,
    endDate,
    note: '',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  }
}

const response = {
  employees: [
    { id: 'user-1', displayName: 'Ada Lovelace', avatarUrl: '', role: 'member' },
    { id: 'user-2', displayName: 'Grace Hopper', avatarUrl: '', role: 'member' },
    { id: 'user-3', displayName: 'Katherine Johnson', avatarUrl: '', role: 'member' },
  ],
  records: [
    // Friday through Monday verifies that weekend cells never contain a bar.
    record('record-own', 'user-1', '2026-07-17', '2026-07-20'),
    record('record-other', 'user-2', '2026-07-08', '2026-07-09'),
  ],
}

async function mountShell(role: 'member' | 'admin' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const authStore = useAuthStore()
  authStore.user = {
    id: 'user-1',
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    avatarUrl: '',
    role,
  }
  const dayoffsStore = useDayoffsStore()
  dayoffsStore.selectedMonth = new Date(2026, 6, 1)

  const wrapper = mount(DayoffsShell, {
    attachTo: document.body,
    global: { plugins: [pinia] },
  })
  await flushPromises()
  return wrapper
}

describe('DayoffsShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(dayoffsList).mockResolvedValue(response)
    document.body.innerHTML = ''
  })

  it('shows employees without records and never draws leave bars in Saturday/Sunday cells', async () => {
    const wrapper = await mountShell()

    // The grid must be as wide as all fixed date columns, rather than ending
    // at the scroll viewport and leaving the far-right cells without row borders.
    expect(wrapper.get('[data-testid="dayoffs-calendar-grid"]').classes()).toEqual(expect.arrayContaining(['w-max', 'min-w-full']))
    expect(wrapper.find('[data-testid="dayoffs-employee-user-3"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="dayoffs-cell-user-1-2026-07-17"]').find('[role="img"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="dayoffs-cell-user-1-2026-07-18"]').find('[role="img"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="dayoffs-cell-user-1-2026-07-19"]').find('[role="img"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="dayoffs-cell-user-1-2026-07-20"]').find('[role="img"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="dayoffs-header-2026-07-18"]').classes()).toContain('bg-app-tertiary')
    expect(wrapper.get('[data-testid="dayoffs-cell-user-1-2026-07-18"]').classes()).toContain('bg-app-tertiary/80')

    wrapper.unmount()
  })

  it('keeps another member record read-only but exposes controls to an administrator', async () => {
    const memberWrapper = await mountShell('member')
    await memberWrapper.get('[data-testid="dayoffs-employee-user-2"]').trigger('click')
    await nextTick()

    expect(memberWrapper.find('[data-testid="dayoffs-edit-record-other"]').exists()).toBe(false)
    expect(memberWrapper.find('[data-testid="dayoffs-delete-record-other"]').exists()).toBe(false)
    expect(memberWrapper.find('[data-testid="dayoffs-add-selected"]').exists()).toBe(false)
    memberWrapper.unmount()

    const adminWrapper = await mountShell('admin')
    await adminWrapper.get('[data-testid="dayoffs-employee-user-2"]').trigger('click')
    await nextTick()

    expect(adminWrapper.find('[data-testid="dayoffs-edit-record-other"]').exists()).toBe(true)
    expect(adminWrapper.find('[data-testid="dayoffs-delete-record-other"]').exists()).toBe(true)
    expect(adminWrapper.find('[data-testid="dayoffs-add-selected"]').exists()).toBe(true)
    adminWrapper.unmount()
  })

  it('uses the bootstrapped workspace identity while the profile is still unavailable', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const authStore = useAuthStore()
    authStore.authState = 'AUTHENTICATED'
    authStore.user = null
    const chatStore = useChatStore()
    chatStore.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      selfUserId: 'user-1',
      selfDisplayName: 'Ada Lovelace',
      selfAvatarUrl: '',
      selfCustomStatus: null,
      selfRole: 'member',
    }
    const dayoffsStore = useDayoffsStore()
    dayoffsStore.selectedMonth = new Date(2026, 6, 1)

    const wrapper = mount(DayoffsShell, {
      attachTo: document.body,
      global: { plugins: [pinia] },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="dayoffs-add"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="dayoffs-employee-user-1"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="dayoffs-add-selected"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('DayoffDialog', () => {
  it('shows local date validation before a mutation is submitted', async () => {
    const wrapper = mount(DayoffDialog, {
      attachTo: document.body,
      props: {
        open: true,
        record: null,
        employees: response.employees,
        selfUserId: 'user-1',
        initialUserId: 'user-1',
        isElevated: false,
        saving: false,
        error: '',
      },
    })
    await nextTick()

    const start = document.body.querySelector('[data-testid="dayoffs-form-start-date"]') as HTMLInputElement
    const end = document.body.querySelector('[data-testid="dayoffs-form-end-date"]') as HTMLInputElement
    start.value = '2026-07-20'
    start.dispatchEvent(new Event('input', { bubbles: true }))
    end.value = '2026-07-17'
    end.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    expect(document.body.textContent).toContain('The end date must be on or after the start date.')
    expect(document.body.querySelector('[data-testid="dayoffs-form-submit"]')?.hasAttribute('disabled')).toBe(true)
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })
})
