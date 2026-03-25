import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOwnedAttachmentBlob } from '@/services/http/attachmentOwnersApi'
import {
  buildTaskPdfExportDocument,
  buildTaskPdfFileName,
} from '@/services/taskPdfExport'

vi.mock('@/services/http/attachmentOwnersApi', () => ({
  fetchOwnedAttachmentBlob: vi.fn(),
}))

describe('taskPdfExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds the expected PDF filename', () => {
    expect(buildTaskPdfFileName({ public_id: 'TASK-1' })).toBe('TASK-1.pdf')
  })

  it('renders markdown blocks into export html', async () => {
    const documentModel = await buildTaskPdfExportDocument({
      public_id: 'TASK-1',
      title: 'Initial title',
      description: '## Heading\n\nBody paragraph',
    })

    expect(documentModel.header).toBe('TASK-1 Initial title')
    expect(documentModel.blocks).toEqual([
      expect.objectContaining({
        kind: 'markdown',
        html: expect.stringContaining('<h2>Heading</h2>'),
      }),
    ])
  })

  it('embeds inline image attachments in the export model', async () => {
    vi.mocked(fetchOwnedAttachmentBlob).mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }))

    const documentModel = await buildTaskPdfExportDocument({
      public_id: 'TASK-1',
      title: 'Initial title',
      description: '![Photo.png](msgnr-attachment://task/task-1/att-image)',
    })

    expect(fetchOwnedAttachmentBlob).toHaveBeenCalledWith('task', 'task-1', 'att-image')
    expect(documentModel.blocks).toEqual([
      expect.objectContaining({
        kind: 'image',
        fileName: 'Photo.png',
        src: expect.stringContaining('data:image/png;base64,'),
      }),
    ])
  })

  it('lists file attachments without treating them as inline images', async () => {
    const documentModel = await buildTaskPdfExportDocument({
      public_id: 'TASK-1',
      title: 'Initial title',
      description: '[Spec.pdf](msgnr-attachment://document/doc-1/att-file)',
    })

    expect(fetchOwnedAttachmentBlob).not.toHaveBeenCalled()
    expect(documentModel.blocks).toEqual([
      {
        kind: 'file',
        fileName: 'Spec.pdf',
      },
    ])
  })
})
