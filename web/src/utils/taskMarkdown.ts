import MarkdownIt from 'markdown-it'

const taskMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

export function renderTaskMarkdownToHtml(input: string): string {
  return taskMarkdown.render(input ?? '')
}
