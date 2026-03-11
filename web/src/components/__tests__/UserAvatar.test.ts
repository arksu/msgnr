import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UserAvatar from '@/components/UserAvatar.vue'

describe('UserAvatar', () => {
  it('renders initials fallback and stable color for the same user id', () => {
    const first = mount(UserAvatar, {
      props: {
        userId: 'user-42',
        displayName: 'Ada Lovelace',
      },
    })
    const second = mount(UserAvatar, {
      props: {
        userId: 'user-42',
        displayName: 'Different Name',
      },
    })

    expect(first.text()).toContain('A')
    expect(second.text()).toContain('D')

    const firstColor = first.find('[style]').attributes('style')
    const secondColor = second.find('[style]').attributes('style')
    expect(firstColor).toBe(secondColor)
  })

  it('shows avatar image when url is provided and falls back to initials on error', async () => {
    const wrapper = mount(UserAvatar, {
      props: {
        userId: 'user-1',
        displayName: 'Bob',
        avatarUrl: '/api/public/avatars/avatars/user-1/pic.png',
      },
    })

    expect(wrapper.find('img').exists()).toBe(true)

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('B')
  })

  it('renders presence badge when presence is provided', () => {
    const wrapper = mount(UserAvatar, {
      props: {
        userId: 'user-7',
        displayName: 'Eve',
        presence: 'online',
      },
    })

    const badge = wrapper.find('span.absolute')
    expect(badge.exists()).toBe(true)
    expect(badge.classes()).toContain('bg-green-400')
  })
})
