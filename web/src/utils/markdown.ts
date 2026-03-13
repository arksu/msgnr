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
  return String(marked.parse(safe, { breaks: true }))
}

