import { describe, expect, it } from 'vitest'
import { renderMarkdownToHtml } from '@/utils/markdown'

describe('renderMarkdownToHtml', () => {
  it('restores escaped br tags as line breaks', () => {
    const html = renderMarkdownToHtml('| A |\n| --- |\n| one<br>two |')

    expect(html).toContain('<td>one<br>two</td>')
    expect(html).not.toContain('&lt;br&gt;')
  })
})
