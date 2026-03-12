import type {
  AppNotificationOptions,
  AppNotificationPermission,
  PlatformAdapter,
} from '@/platform/types'
import { useNotificationSoundEngine } from '@/services/sound'

function toPermission(result: NotificationPermission | string): AppNotificationPermission {
  if (result === 'granted' || result === 'denied' || result === 'default') return result
  return 'default'
}

export class PwaAdapter implements PlatformAdapter {
  readonly type = 'pwa' as const

  notifications: PlatformAdapter['notifications'] = {
    requestPermission: async () => {
      if (typeof window === 'undefined' || !('Notification' in window)) return 'denied'
      return toPermission(await Notification.requestPermission())
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
      const sound = useNotificationSoundEngine()
      if (soundId === 'message-ping') {
        await sound.playMessagePing()
        return
      }
      if (soundId === 'call-member-joined') {
        await sound.playCallMemberJoined()
        return
      }
      if (soundId === 'call-member-left') {
        await sound.playCallMemberLeft()
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
