import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/sound', () => ({
  useNotificationSoundEngine: () => ({
    playMessagePing: vi.fn(),
    playCallMemberJoined: vi.fn(),
    playCallMemberLeft: vi.fn(),
  }),
}))

describe('TauriAdapter files.saveBlob', () => {
  beforeEach(() => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = undefined
    ;(window as Window & { __TAURI_INTERNALS__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__ = undefined
  })

  it('returns a clean cancel result when native save is dismissed', async () => {
    const invoke = vi.fn(async () => ({ saved: false }))
    ;(window as Window & { __TAURI_INTERNALS__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__ = { invoke }

    const { TauriAdapter } = await import('@/platform/tauri-adapter')
    const adapter = new TauriAdapter()
    const result = await adapter.files.saveBlob({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      suggestedName: 'TASK-1.pdf',
      mimeType: 'application/pdf',
    })

    expect(result).toEqual({ saved: false })
    expect(invoke).toHaveBeenCalledWith('save_pdf_file', expect.objectContaining({
      suggestedName: 'TASK-1.pdf',
    }))
  })
})
