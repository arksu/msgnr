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

  it('renders escaped br tokens inside markdown tables as line breaks', () => {
    const html = renderTaskMarkdownToHtml('| A |\n| --- |\n| one<br>two |')

    expect(html).toContain('<td>one<br>two</td>')
    expect(html).not.toContain('&lt;br&gt;')
  })

  it('renders fenced code with language-aware syntax highlighting', () => {
    const html = renderTaskMarkdownToHtml('```python\ndef hello(name):\n    return f"hi {name}"\n```')

    expect(html).toContain('language-python')
    expect(html).toContain('data-language="Python"')
    expect(html).toContain('<span class="hljs-keyword">def</span>')
  })
})
