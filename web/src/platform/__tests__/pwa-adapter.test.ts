import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaAdapter } from '@/platform/pwa-adapter'

describe('PwaAdapter files.saveBlob', () => {
  const originalCreateElement = document.createElement.bind(document)

  beforeEach(() => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker
  })

  it('uses the save picker when available', async () => {
    const write = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const createWritable = vi.fn(async () => ({ write, close }))
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }))
    ;(window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker

    const adapter = new PwaAdapter()
    const result = await adapter.files.saveBlob({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      suggestedName: 'TASK-1.pdf',
      mimeType: 'application/pdf',
    })

    expect(result).toEqual({ saved: true })
    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'TASK-1.pdf',
    }))
    expect(write).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  it('falls back to browser download when no picker exists', async () => {
    const click = vi.fn()
    const anchor = {
      href: '',
      download: '',
      click,
    }
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'a') {
        return anchor as unknown as HTMLAnchorElement
      }
      return originalCreateElement(tagName)
    }) as typeof document.createElement)

    const adapter = new PwaAdapter()
    const result = await adapter.files.saveBlob({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      suggestedName: 'TASK-1.pdf',
      mimeType: 'application/pdf',
    })

    expect(result).toEqual({ saved: true })
    expect(anchor.download).toBe('TASK-1.pdf')
    expect(click).toHaveBeenCalledTimes(1)
    createElementSpy.mockRestore()
  })
})
