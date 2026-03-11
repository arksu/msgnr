import { storage } from '@/services/storage/storageAdapter'

const LAST_CONVERSATION_BY_USER_KEY = 'msgnr:last-conversation-by-user:v1'
const LAST_CONVERSATION_GLOBAL_KEY = 'msgnr:last-conversation:global:v1'

type LastConversationBucket = Record<string, string>

function scopeKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`
}

function readBucket(): LastConversationBucket {
  const raw = storage.getItem(LAST_CONVERSATION_BY_USER_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const normalized: LastConversationBucket = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) normalized[k] = v
    }
    return normalized
  } catch {
    return {}
  }
}

function writeBucket(bucket: LastConversationBucket) {
  storage.setItem(LAST_CONVERSATION_BY_USER_KEY, JSON.stringify(bucket))
}

export function loadLastOpenedConversation(workspaceId: string, userId: string): string {
  const bucket = readBucket()
  if (workspaceId && userId) {
    const scoped = bucket[scopeKey(workspaceId, userId)] ?? ''
    if (scoped) return scoped
  }
  return storage.getItem(LAST_CONVERSATION_GLOBAL_KEY) ?? ''
}

export function saveLastOpenedConversation(workspaceId: string, userId: string, conversationId: string) {
  if (!conversationId) return
  if (workspaceId && userId) {
    const bucket = readBucket()
    bucket[scopeKey(workspaceId, userId)] = conversationId
    writeBucket(bucket)
  }
  storage.setItem(LAST_CONVERSATION_GLOBAL_KEY, conversationId)
}

export function clearLastOpenedConversation(workspaceId: string, userId: string) {
  if (workspaceId && userId) {
    const bucket = readBucket()
    delete bucket[scopeKey(workspaceId, userId)]
    writeBucket(bucket)
  }
  storage.removeItem(LAST_CONVERSATION_GLOBAL_KEY)
}

export function clearAllLastOpenedConversations() {
  storage.removeItem(LAST_CONVERSATION_BY_USER_KEY)
  storage.removeItem(LAST_CONVERSATION_GLOBAL_KEY)
}
