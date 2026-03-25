import { Marked } from 'marked'

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderHtmlToken(token: { text: string }): string {
  if (/^<br\s*\/?>$/i.test(token.text)) {
    return '<br>'
  }

  return escapeHtml(token.text)
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: renderHtmlToken,
  },
})

export function renderMarkdownToHtml(input: string): string {
  return String(markdown.parse(input ?? ''))
}

export function renderMarkdownInlineToHtml(input: string): string {
  if (!input) return ''
  const safe = input.replace(/\r\n/g, '\n')
  return safe
    .split('\n')
    .map(part => String(markdown.parseInline(part)))
    .join('<br>')
}
