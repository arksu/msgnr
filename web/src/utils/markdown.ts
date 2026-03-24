import { marked } from 'marked'

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderMarkdownToHtml(input: string): string {
  const safe = escapeHtml(input)
  const rendered = String(marked.parse(safe, { breaks: true }))
  return rendered.replace(/&lt;br\s*\/?&gt;/gi, '<br>')
}

export function renderMarkdownInlineToHtml(input: string): string {
  if (!input) return ''
  const safe = escapeHtml(input).replace(/\r\n/g, '\n')
  return safe
    .split('\n')
    .map(part => String(marked.parseInline(part)))
    .join('<br>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
}
