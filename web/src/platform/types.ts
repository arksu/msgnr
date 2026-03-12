export type PlatformType = 'pwa' | 'tauri'

export type AppNotificationPermission = 'granted' | 'denied' | 'default'

export interface AppNotificationOptions {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  conversationId?: string
  url?: string
  silent?: boolean
  onClick?: () => void
}

export interface PlatformAdapter {
  readonly type: PlatformType

  notifications: {
    requestPermission(): Promise<AppNotificationPermission>
    show(options: AppNotificationOptions): Promise<void>
    setBadge(count: number): Promise<void>
    clearBadge(): Promise<void>
    playSound?(soundId: string): Promise<void> | void
  }

  system: {
    setTrayTitle?(title: string): Promise<void> | void
    setTrayIcon?(icon: string): Promise<void> | void
    setTrayTooltip?(tooltip: string): Promise<void> | void
    showTrayBalloon?(title: string, body: string): Promise<void> | void
    getAutoLaunch?(): Promise<boolean>
    setAutoLaunch?(enabled: boolean): Promise<void>
    checkForUpdates?(): Promise<{ updated: boolean; version?: string; error?: string }>
    invokeNative?<T>(command: string, args?: Record<string, unknown>): Promise<T>
  }

  window: {
    minimize?(): Promise<void> | void
    close?(): Promise<void> | void
    focus?(): Promise<void> | void
    isVisible?(): Promise<boolean> | boolean
    setCloseToTray?(enabled: boolean): Promise<void> | void
  }

  storage: {
    getSecureItem?(key: string): Promise<string | null>
    setSecureItem?(key: string, value: string): Promise<void>
    deleteSecureItem?(key: string): Promise<void>
  }

  lifecycle: {
    init(): Promise<void>
    dispose(): Promise<void>
  }
}
