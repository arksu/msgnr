type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
}

function resolveGlobalStorage(): unknown {
  const target = globalThis as { localStorage?: any }
  return target.localStorage
}

function normalizeStorage(raw: unknown): StorageLike {
  const target = globalThis as { localStorage?: StorageLike }
  if (raw
    && typeof (raw as any).getItem === 'function'
    && typeof (raw as any).setItem === 'function'
    && typeof (raw as any).removeItem === 'function'
    && typeof (raw as any).clear === 'function') {
    return raw as StorageLike
  }

  const initialBag: Record<string, string> = {}
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') initialBag[key] = value
    }
  }

  const bag: Record<string, string> = { ...initialBag }
  const normalized: StorageLike = {
    getItem(key: string): string | null {
      const value = bag[key]
      return typeof value === 'string' ? value : null
    },
    setItem(key: string, value: string): void {
      bag[key] = String(value)
    },
    removeItem(key: string): void {
      delete bag[key]
    },
    clear(): void {
      for (const key of Object.keys(bag)) {
        delete bag[key]
      }
    },
  }
  try {
    Object.defineProperty(target, 'localStorage', {
      value: normalized,
      configurable: true,
      writable: true,
    })
  } catch {
    // In very restricted runtimes localStorage may be non-configurable.
  }
  return normalized
}

export const storage: StorageLike = normalizeStorage(resolveGlobalStorage())
