import { normalizeNotificationPermission } from '@/platform/types'
import type { AppNotificationOptions, PlatformAdapter } from '@/platform/types'
import { useNotificationSoundEngine } from '@/services/sound'

export class PwaAdapter implements PlatformAdapter {
  readonly type = 'pwa' as const
  private readonly soundEngine = useNotificationSoundEngine()

  notifications: PlatformAdapter['notifications'] = {
    requestPermission: async () => {
      if (typeof window === 'undefined' || !('Notification' in window)) return 'denied'
      return normalizeNotificationPermission(await Notification.requestPermission())
    },
    show: async (options: AppNotificationOptions) => {
      if (typeof window === 'undefined' || !('Notification' in window)) return
      if (Notification.permission !== 'granted') return
      const notification = new Notification(options.title, {
        body: options.body,
        icon: options.icon,
        badge: options.badge,
        tag: options.tag,
        silent: options.silent,
      })
      if (options.onClick) {
        notification.onclick = () => {
          options.onClick?.()
          notification.close()
        }
      }
    },
    setBadge: async (count: number) => {
      if (typeof navigator === 'undefined') return
      const nav = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void> }
      if (typeof nav.setAppBadge !== 'function') return
      try {
        await nav.setAppBadge(Math.max(0, count))
      } catch {
        // Best effort.
      }
    },
    clearBadge: async () => {
      if (typeof navigator === 'undefined') return
      const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> }
      if (typeof nav.clearAppBadge !== 'function') return
      try {
        await nav.clearAppBadge()
      } catch {
        // Best effort.
      }
    },
    playSound: async (soundId: string) => {
      if (soundId === 'message-ping') {
        await this.soundEngine.playMessagePing()
        return
      }
      if (soundId === 'call-member-joined') {
        await this.soundEngine.playCallMemberJoined()
        return
      }
      if (soundId === 'call-member-left') {
        await this.soundEngine.playCallMemberLeft()
      }
    },
  }

  system: PlatformAdapter['system'] = {}
  window: PlatformAdapter['window'] = {}
  storage: PlatformAdapter['storage'] = {}

  lifecycle: PlatformAdapter['lifecycle'] = {
    init: async () => {
      // Service worker lifecycle is handled by vite-plugin-pwa.
    },
    dispose: async () => {
      // No-op for browser runtime.
    },
  }
}
