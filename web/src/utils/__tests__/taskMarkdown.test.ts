import { describe, expect, it } from 'vitest'
import { renderTaskMarkdownToHtml } from '@/utils/taskMarkdown'
import { tiptapJsonToMarkdown } from '@/utils/tiptapMarkdown'

describe('task markdown helpers', () => {
  it('renders markdown task lists as checkbox HTML', () => {
    const html = renderTaskMarkdownToHtml('- [ ] Text....')

    expect(html).toContain('data-type="taskList"')
    expect(html).toContain('data-type="taskItem"')
    expect(html).toContain('data-checked="false"')
    expect(html).toContain('<input type="checkbox"')
  })

  it('serializes task list nodes back to markdown checkboxes', () => {
    const markdown = tiptapJsonToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: {
                checked: false,
              },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'First item' },
                  ],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: {
                checked: true,
              },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Second item' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    expect(markdown).toContain('- [ ] First item')
    expect(markdown).toContain('- [x] Second item')
  })
})
