import { describe, expect, it } from 'vitest'
import {
  buildAttachmentMarkdown,
  buildAttachmentUrl,
  parseAttachmentTokenLine,
  parseAttachmentUrl,
  splitMarkdownWithAttachmentBlocks,
} from '@/utils/attachmentMarkdown'

describe('attachmentMarkdown', () => {
  it('builds and parses attachment urls', () => {
    const url = buildAttachmentUrl('task', 'task-1', 'att-1')
    expect(url).toBe('msgnr-attachment://task/task-1/att-1')
    expect(parseAttachmentUrl(url)).toEqual({
      ownerKind: 'task',
      ownerId: 'task-1',
      attachmentId: 'att-1',
    })
  })

  it('parses image and file token lines', () => {
    expect(parseAttachmentTokenLine('![Photo](msgnr-attachment://task/task-1/att-1)')).toMatchObject({
      kind: 'image',
      fileName: 'Photo',
      ownerKind: 'task',
      ownerId: 'task-1',
      attachmentId: 'att-1',
    })

    expect(parseAttachmentTokenLine('[Spec.pdf](msgnr-attachment://document/doc-1/att-2)')).toMatchObject({
      kind: 'file',
      fileName: 'Spec.pdf',
      ownerKind: 'document',
      ownerId: 'doc-1',
      attachmentId: 'att-2',
    })
  })

  it('splits markdown into markdown and attachment blocks', () => {
    const markdown = [
      '# Title',
      '',
      '![Photo](msgnr-attachment://task/task-1/att-1)',
      '',
      'After image',
      '',
      buildAttachmentMarkdown('document', 'doc-1', 'att-2', 'Spec.pdf', 'application/pdf'),
    ].join('\n')

    expect(splitMarkdownWithAttachmentBlocks(markdown)).toEqual([
      { type: 'markdown', content: '# Title\n' },
      {
        type: 'attachment',
        token: {
          kind: 'image',
          fileName: 'Photo',
          ownerKind: 'task',
          ownerId: 'task-1',
          attachmentId: 'att-1',
          url: 'msgnr-attachment://task/task-1/att-1',
        },
      },
      { type: 'markdown', content: '\nAfter image\n' },
      {
        type: 'attachment',
        token: {
          kind: 'file',
          fileName: 'Spec.pdf',
          ownerKind: 'document',
          ownerId: 'doc-1',
          attachmentId: 'att-2',
          url: 'msgnr-attachment://document/doc-1/att-2',
        },
      },
    ])
  })
})
