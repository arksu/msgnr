import type { MessageEntity } from '@/stores/chat'
import { escapeHtml, renderMarkdownInlineToHtml, renderMarkdownToHtml } from '@/utils/markdown'
import { sortMessageEntities } from '@/utils/messageEntities'

function renderEntity(entity: MessageEntity): string {
  const label = escapeHtml(entity.label)
  const targetId = escapeHtml(entity.targetId)
  if (entity.kind === 'user') {
    return `<button type="button" class="inline rounded px-0.5 font-medium text-cyan-300 hover:bg-cyan-400/10 hover:text-cyan-200" data-message-entity-kind="user" data-target-id="${targetId}">${label}</button>`
  }

  const href = escapeHtml(entity.href)
  return `<a href="${href}" class="font-medium text-cyan-300 hover:text-cyan-200 underline decoration-cyan-500/40" data-message-entity-kind="${escapeHtml(entity.kind)}" data-target-id="${targetId}">${label}</a>`
}

export function renderMessageBodyWithEntities(body: string, entities: MessageEntity[]): string {
  if (!body) return ''
  if (entities.length === 0) {
    return renderMarkdownToHtml(body)
  }

  const sorted = sortMessageEntities(entities)
  let cursor = 0
  let html = ''

  for (const entity of sorted) {
    if (entity.start < cursor || entity.end > body.length || entity.start >= entity.end) {
      continue
    }
    html += renderMarkdownInlineToHtml(body.slice(cursor, entity.start))
    html += renderEntity(entity)
    cursor = entity.end
  }

  html += renderMarkdownInlineToHtml(body.slice(cursor))
  return html
}
