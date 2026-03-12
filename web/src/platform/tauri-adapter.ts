import type {
  AppNotificationOptions,
  AppNotificationPermission,
  PlatformAdapter,
} from '@/platform/types'

type TauriNotificationBridge = {
  isPermissionGranted?: () => Promise<boolean>
  requestPermission?: () => Promise<string>
  sendNotification?: (options: { title: string; body: string; icon?: string }) => Promise<void> | void
}

type TauriUpdaterBridge = {
  check?: () => Promise<
    | {
        version?: string
        downloadAndInstall?: () => Promise<void>
      }
    | null
  >
}

type TauriWindowHandle = {
  minimize?: () => Promise<void>
  close?: () => Promise<void>
  setFocus?: () => Promise<void>
  isVisible?: () => Promise<boolean>
}

type TauriWindowBridge = {
  getCurrentWindow?: () => TauriWindowHandle
}

type TauriBridge = {
  core?: {
    invoke?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  }
  notification?: TauriNotificationBridge
  updater?: TauriUpdaterBridge
  window?: TauriWindowBridge
}

type TauriInternalsBridge = {
  invoke?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
}

function tauriBridge(): TauriBridge {
  if (typeof window === 'undefined') return {}
  const win = window as Window & {
    __TAURI__?: TauriBridge
    __TAURI_INTERNALS__?: TauriInternalsBridge
  }
  if (win.__TAURI__) return win.__TAURI__
  if (win.__TAURI_INTERNALS__?.invoke) {
    return {
      core: {
        invoke: win.__TAURI_INTERNALS__.invoke,
      },
    }
  }
  return {}
}

async function invokeNative<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = tauriBridge()
  const invoke = bridge.core?.invoke
  if (typeof invoke !== 'function') {
    throw new Error('Tauri invoke bridge is unavailable.')
  }
  return invoke<T>(command, args)
}

function toPermission(result: string): AppNotificationPermission {
  if (result === 'granted' || result === 'denied' || result === 'default') return result
  if (result === 'prompt' || result === 'prompt-with-rationale') return 'default'
  return 'default'
}

export class TauriAdapter implements PlatformAdapter {
  readonly type = 'tauri' as const

  notifications: PlatformAdapter['notifications'] = {
    requestPermission: async () => {
      const bridge = tauriBridge().notification
      try {
        if (bridge?.isPermissionGranted && await bridge.isPermissionGranted()) {
          return 'granted'
        }
        if (bridge?.requestPermission) {
          return toPermission(await bridge.requestPermission())
        }
      } catch {
        // Fall through to invoke-based path.
      }

      // Fallback for release builds where __TAURI__.notification bridge is not injected.
      try {
        const alreadyGranted = await invokeNative<boolean | null>('plugin:notification|is_permission_granted')
        if (alreadyGranted === true) {
          return 'granted'
        }
        const result = await invokeNative<string>('plugin:notification|request_permission')
        return toPermission(result)
      } catch {
        // Fall through to browser Notification API.
      }

      try {
        if (typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function') {
          return toPermission(await Notification.requestPermission())
        }
      } catch {
        // Fall through to denied.
      }
      return 'denied'
    },
    show: async (options: AppNotificationOptions) => {
      const bridge = tauriBridge().notification
      try {
        if (bridge?.sendNotification) {
          await bridge.sendNotification({
            title: options.title,
            body: options.body,
            icon: options.icon,
          })
          return
        }
      } catch {
        // Fall through to invoke fallback.
      }

      try {
        await invokeNative('plugin:notification|notify', {
          options: {
            title: options.title,
            body: options.body,
            icon: options.icon,
          },
        })
        return
      } catch {
        // Fall through to app command fallback.
      }

      try {
        await invokeNative('show_notification', {
          title: options.title,
          body: options.body,
          icon: options.icon,
        })
      } catch {
        // Best effort.
      }
    },
    setBadge: async (count: number) => {
      await invokeNative('set_badge_count', { count: Math.max(0, Math.floor(count)) })
    },
    clearBadge: async () => {
      await invokeNative('set_badge_count', { count: 0 })
    },
    playSound: async (soundId: string) => {
      await invokeNative('play_sound', { soundId })
    },
  }

  system: PlatformAdapter['system'] = {
    setTrayTitle: async (title: string) => {
      await invokeNative('set_tray_title', { title })
    },
    setTrayTooltip: async (tooltip: string) => {
      await invokeNative('set_tray_tooltip', { tooltip })
    },
    checkForUpdates: async () => {
      const updater = tauriBridge().updater
      try {
        if (!updater?.check) {
          return { updated: false }
        }
        const update = await updater.check()
        if (!update?.downloadAndInstall) {
          return { updated: false }
        }
        await update.downloadAndInstall()
        return { updated: true, version: update.version }
      } catch (error) {
        return {
          updated: false,
          error: error instanceof Error ? error.message : 'Failed to check for updates.',
        }
      }
    },
    invokeNative: async <T>(command: string, args?: Record<string, unknown>) => invokeNative<T>(command, args),
  }

  window: PlatformAdapter['window'] = {
    minimize: async () => {
      await tauriBridge().window?.getCurrentWindow?.().minimize?.()
    },
    close: async () => {
      await tauriBridge().window?.getCurrentWindow?.().close?.()
    },
    focus: async () => {
      await tauriBridge().window?.getCurrentWindow?.().setFocus?.()
    },
    isVisible: async () => {
      try {
        return await tauriBridge().window?.getCurrentWindow?.().isVisible?.() ?? true
      } catch {
        return true
      }
    },
    setCloseToTray: async (enabled: boolean) => {
      await invokeNative('set_close_to_tray', { enabled })
    },
  }

  storage: PlatformAdapter['storage'] = {
    getSecureItem: async (key: string) => invokeNative<string | null>('keyring_get', { key }),
    setSecureItem: async (key: string, value: string) => {
      await invokeNative('keyring_set', { key, value })
    },
    deleteSecureItem: async (key: string) => {
      await invokeNative('keyring_delete', { key })
    },
  }

  lifecycle: PlatformAdapter['lifecycle'] = {
    init: async () => {
      await this.window.setCloseToTray?.(true)
    },
    dispose: async () => {
      // No-op for now.
    },
  }
}
