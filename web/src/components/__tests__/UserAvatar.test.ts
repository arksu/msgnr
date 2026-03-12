import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import UserAvatar from '@/components/UserAvatar.vue'

afterEach(() => {
  ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = undefined
  localStorage.removeItem('msgnr.desktop.backend_base_url')
})

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

  it('resolves relative avatar url against backend base url in tauri runtime', () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    localStorage.setItem('msgnr.desktop.backend_base_url', 'http://localhost:8080')

    const wrapper = mount(UserAvatar, {
      props: {
        userId: 'user-9',
        displayName: 'Tauri User',
        avatarUrl: '/api/public/avatars/avatars/user-9/avatar.png',
      },
    })

    expect(wrapper.get('img').attributes('src')).toBe('http://localhost:8080/api/public/avatars/avatars/user-9/avatar.png')
  })
})
