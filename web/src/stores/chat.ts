import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  CallStatus,
  ConversationType,
  PresenceStatus,
  WorkspaceRole,
} from '@/shared/proto/packets_pb'
import type {
  ServerEvent,
  SendMessageAck,
  ReactionAck,
  SubscribeThreadResponse,
  MessageEvent as ProtoMessageEvent,
  ThreadSummaryUpdatedEvent,
  ReactionUpdatedEvent,
  BootstrapResponse,
  SyncSinceResponse,
  AckResponse,
  ReadCursorAck,
  ConversationSummary,
  ReadCounterUpdatedEvent,
  NotificationAddedEvent,
  CallStateChangedEvent,
  CallInviteCreatedEvent,
  CallInviteCancelledEvent,
  NotificationResolvedEvent,
  NotificationSummary,
  ActiveCallSummary,
  CallInviteSummary,
  PresenceEvent,
} from '@/shared/proto/packets_pb'
import { useWsStore } from '@/stores/ws'
import { useAuthStore } from '@/stores/auth'
import { loadLastAppliedEventSeq, saveLastAppliedEventSeq } from '@/services/storage/syncStateStorage'
import { storage } from '@/services/storage/storageAdapter'
import {
  loadLastOpenedConversation,
  saveLastOpenedConversation,
  clearLastOpenedConversation,
} from '@/services/storage/lastConversationStorage'
import { listConversationMessages, listDmCandidates } from '@/services/http/chatApi'
import type { ConversationMessageItem } from '@/services/http/chatApi'
import { getOrCreateClientInstanceId } from '@/services/storage/clientInstanceStorage'
import { generateId } from '@/services/id'

// ── Domain types ──────────────────────────────────────────────────────────────

export interface Channel {
  id: string
  name: string
  kind: 'channel' | 'dm'
  visibility: 'public' | 'private' | 'dm'
  unread: number
  hasUnreadThreadReplies?: boolean
  lastMessageSeq?: bigint
  lastActivityAt?: string
}

export interface DirectMessage {
  id: string
  userId: string
  displayName: string
  avatarUrl?: string
  presence: 'online' | 'away' | 'offline'
  unread: number
  hasUnreadThreadReplies?: boolean
  lastMessageSeq?: bigint
}

export interface ActiveConversation {
  id: string
  title: string
  kind: 'channel' | 'dm'
  visibility: 'public' | 'private' | 'dm'
  unread: number
}

export interface ReactionCount {
  emoji: string
  count: number
}

export interface MessageAttachment {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
}

export interface Message {
  id: string
  channelId: string
  senderId: string
  senderName: string
  senderAvatarUrl?: string
  body: string
  channelSeq: bigint
  threadSeq: bigint
  threadRootMessageId?: string
  mentionedUserIds: string[]
  mentionEveryone: boolean
  createdAt: string
  reactions: ReactionCount[]
  myReactions: string[]
  attachments?: MessageAttachment[]
  clientMsgId?: string
  pending?: boolean
}

interface PendingReactionOp {
  channelId: string
  messageId: string
  emoji: string
  op: 'add' | 'remove'
  timeout: ReturnType<typeof setTimeout>
}

interface ToastState {
  id: number
  message: string
}

export interface ThreadSummary {
  replyCount: number
  lastThreadSeq: bigint
  lastReplyAt?: string
  lastReplyUserId?: string
}

export interface WorkspaceShell {
  id: string
  name: string
  selfUserId: string
  selfDisplayName: string
  selfAvatarUrl?: string
  selfRole: string
}

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  conversationId: string
  isRead: boolean
  createdAt: string
}

export interface ActiveCallItem {
  id: string
  conversationId: string
  status: string
  participantCount: number
}

export interface PendingInviteItem {
  id: string
  callId: string
  conversationId: string
  inviterUserId: string
  state: string
  createdAt: string
  expiresAt: string
}

export interface TypingState {
  userId: string
  expiresAt?: string
}

interface StoredThreadSummary {
  replyCount: number
  lastThreadSeq: string
  lastReplyAt?: string
  lastReplyUserId?: string
}

type StoredThreadSummariesByUser = Record<string, Record<string, StoredThreadSummary>>

interface BootstrapStage {
  snapshotSeq: bigint
  workspace: WorkspaceShell | null
  conversations: ConversationSummary[]
  notifications: NotificationSummary[]
  activeCalls: ActiveCallSummary[]
  pendingInvites: CallInviteSummary[]
  unread: Map<string, { unreadMessages: number; unreadMentions: number; hasUnreadThreadReplies: boolean }>
  presence: Map<string, PresenceEvent>
}

const ACK_BATCH_SIZE = 20
const ACK_INTERVAL_MS = 2000
const DEFAULT_SYNC_BATCH = 200
const MAX_BUFFERED_SERVER_EVENTS = 512
const REACTION_OP_TIMEOUT_MS = 8000
const TOAST_DURATION_MS = 2800
const THREAD_SUMMARIES_STORAGE_KEY = 'msgnr:thread-summaries:v1'
const DEBUG_REACTIONS = false

interface ConversationHistoryState {
  initialized: boolean
  loading: boolean
  hasMore: boolean
  nextBeforeChannelSeq?: bigint
}

function readStoredThreadSummaryBuckets(): StoredThreadSummariesByUser {
  const raw = storage.getItem(THREAD_SUMMARIES_STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as StoredThreadSummariesByUser
  } catch {
    return {}
  }
}

function loadThreadSummariesForUser(userId: string): Record<string, ThreadSummary> {
  if (!userId) return {}
  const all = readStoredThreadSummaryBuckets()
  const bucket = all[userId]
  if (!bucket || typeof bucket !== 'object') return {}

  const summaries: Record<string, ThreadSummary> = {}
  for (const [rootId, stored] of Object.entries(bucket)) {
    if (!stored || typeof stored !== 'object') continue
    const replyCount = Number.isFinite(stored.replyCount) ? Math.max(0, Math.floor(stored.replyCount)) : 0
    let lastThreadSeq = 0n
    try {
      lastThreadSeq = BigInt(stored.lastThreadSeq ?? '0')
    } catch {
      lastThreadSeq = BigInt(replyCount)
    }
    if (lastThreadSeq < 0n) lastThreadSeq = 0n
    const normalizedReplyCount = Math.max(replyCount, Number(lastThreadSeq))
    summaries[rootId] = {
      replyCount: normalizedReplyCount,
      lastThreadSeq,
      lastReplyAt: stored.lastReplyAt,
      lastReplyUserId: stored.lastReplyUserId,
    }
  }
  return summaries
}

function saveThreadSummariesForUser(userId: string, summaries: Record<string, ThreadSummary>) {
  if (!userId) return
  const all = readStoredThreadSummaryBuckets()
  const nextBucket: Record<string, StoredThreadSummary> = {}
  for (const [rootId, summary] of Object.entries(summaries)) {
    nextBucket[rootId] = {
      replyCount: Math.max(0, Math.floor(summary.replyCount)),
      lastThreadSeq: summary.lastThreadSeq.toString(),
      lastReplyAt: summary.lastReplyAt,
      lastReplyUserId: summary.lastReplyUserId,
    }
  }
  all[userId] = nextBucket
  storage.setItem(THREAD_SUMMARIES_STORAGE_KEY, JSON.stringify(all))
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useChatStore = defineStore('chat', () => {
  const channels = ref<Channel[]>([])
  const directMessages = ref<DirectMessage[]>([])
  const activeChannelId = ref<string>('')
  const workspace = ref<WorkspaceShell | null>(null)
  const notifications = ref<NotificationItem[]>([])
  const activeCalls = ref<ActiveCallItem[]>([])
  const pendingInvites = ref<PendingInviteItem[]>([])
  const presenceByUserId = ref<Record<string, PresenceEvent>>({})
  const typingByConversationId = ref<Record<string, TypingState[]>>({})
  const bootstrapped = ref(false)

  const messages = ref<Record<string, Message[]>>({})
  const conversationHistoryState = new Map<string, ConversationHistoryState>()
  const conversationInitialLoadingById = ref<Record<string, boolean>>({})
  const threadMessages = ref<Record<string, Message[]>>({})
  const threadSummaries = ref<Record<string, ThreadSummary>>({})
  const activeThreadRootId = ref('')
  const activeThreadConversationId = ref('')
  const userNames = ref<Record<string, string>>({})
  const userAvatars = ref<Record<string, string>>({})
  const pendingReactionOps = ref<Record<string, PendingReactionOp>>({})
  const toast = ref<ToastState | null>(null)
  const lastAppliedEventSeq = ref<bigint>(loadLastAppliedEventSeq())
  const lastAckedEventSeq = ref<bigint>(0n)

  const activeChannel = computed(() =>
    channels.value.find(c => c.id === activeChannelId.value) ?? null
  )
  const activeConversation = computed<ActiveConversation | null>(() => {
    const channel = channels.value.find(c => c.id === activeChannelId.value)
    if (channel) {
      return {
        id: channel.id,
        title: channel.name,
        kind: channel.kind,
        visibility: channel.visibility,
        unread: channel.unread,
      }
    }
    const dm = directMessages.value.find(item => item.id === activeChannelId.value)
    if (!dm) return null
    return {
      id: dm.id,
      title: dm.displayName,
      kind: 'dm',
      visibility: 'dm',
      unread: dm.unread,
    }
  })

  const activeMessages = computed(() =>
    messages.value[activeChannelId.value] ?? []
  )
  const isThreadPanelOpen = computed(() =>
    activeThreadRootId.value !== '' && activeThreadConversationId.value !== ''
  )
  const activeThreadRootMessage = computed(() => {
    if (!isThreadPanelOpen.value) return null
    return messages.value[activeThreadConversationId.value]?.find(item => item.id === activeThreadRootId.value) ?? null
  })
  const activeThreadReplies = computed(() => {
    if (!isThreadPanelOpen.value) return []
    const root = activeThreadRootId.value
    const list = [...(threadMessages.value[root] ?? [])]
    list.sort((a, b) => {
      if (a.threadSeq !== b.threadSeq) return Number(a.threadSeq - b.threadSeq)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
    return list
  })

  let bootstrapStage: BootstrapStage | null = null
  let bufferedServerEvents: ServerEvent[] = []
  let seenEventIds = new Set<string>()
  let historyLoadToken = 0
  const historyLoadTokenByConversation = new Map<string, number>()
  let ackTimer: ReturnType<typeof setTimeout> | null = null
  let pendingAckEventCount = 0
  const pendingReadByConversation = new Map<string, bigint>()
  let clientIsActive = true
  const clientInstanceId = getOrCreateClientInstanceId()
  let userDirectoryHydrated = false
  let userDirectoryPromise: Promise<void> | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  const DEBUG_CONVERSATION_OPEN_PERF = true

  function persistThreadSummaries() {
    const userId = workspace.value?.selfUserId ?? ''
    if (!userId) return
    saveThreadSummariesForUser(userId, threadSummaries.value)
  }

  function upsertThreadSummary(rootId: string, summary: ThreadSummary) {
    threadSummaries.value[rootId] = summary
    persistThreadSummaries()
  }

  function logConversationPerf(label: string, payload?: unknown) {
    if (!DEBUG_CONVERSATION_OPEN_PERF) return
    if (typeof payload === 'undefined') {
      console.debug(`[perf][conversation-open] ${label}`)
      return
    }
    console.debug(`[perf][conversation-open] ${label}`, payload)
  }

  function setChannels(list: Channel[]) {
    channels.value = list
    for (const ch of list) {
      if (!messages.value[ch.id]) messages.value[ch.id] = []
    }
  }

  function getOrCreateHistoryState(conversationId: string): ConversationHistoryState {
    const existing = conversationHistoryState.get(conversationId)
    if (existing) return existing
    const next: ConversationHistoryState = {
      initialized: false,
      loading: false,
      hasMore: true,
    }
    conversationHistoryState.set(conversationId, next)
    return next
  }

  function isConversationHistoryLoading(conversationId: string): boolean {
    if (!conversationId) return false
    return getOrCreateHistoryState(conversationId).loading
  }

  function isConversationInitialLoading(conversationId: string): boolean {
    if (!conversationId) return false
    return conversationInitialLoadingById.value[conversationId] === true
  }

  function conversationHasMoreHistory(conversationId: string): boolean {
    if (!conversationId) return false
    return getOrCreateHistoryState(conversationId).hasMore
  }

  function firstPublicChannelId(channelList: Channel[]): string {
    return channelList.find(channel => channel.visibility === 'public')?.id ?? ''
  }

  function conversationExistsInLists(conversationId: string, channelList: Channel[], dmList: DirectMessage[]): boolean {
    if (!conversationId) return false
    return channelList.some(channel => channel.id === conversationId) || dmList.some(dm => dm.id === conversationId)
  }

  function saveActiveConversationSelection(conversationId: string) {
    const authStore = useAuthStore()
    const workspaceId = workspace.value?.id || workspace.value?.name || ''
    const userId = workspace.value?.selfUserId || authStore.user?.id || ''
    if (!conversationId) return
    saveLastOpenedConversation(workspaceId, userId, conversationId)
  }

  function clearActiveConversationSelection() {
    const authStore = useAuthStore()
    const workspaceId = workspace.value?.id || workspace.value?.name || ''
    const userId = workspace.value?.selfUserId || authStore.user?.id || ''
    clearLastOpenedConversation(workspaceId, userId)
  }

  function resolveSnapshotActiveConversation(nextChannels: Channel[], nextDms: DirectMessage[], nextWorkspace: WorkspaceShell | null): string {
    const authStore = useAuthStore()
    const workspaceId = nextWorkspace?.id || nextWorkspace?.name || ''
    const userId = nextWorkspace?.selfUserId || authStore.user?.id || ''
    const persisted = loadLastOpenedConversation(workspaceId, userId)
    if (conversationExistsInLists(persisted, nextChannels, nextDms)) {
      return persisted
    }
    return firstPublicChannelId(nextChannels)
  }

  function selectChannel(id: string) {
    const selectStartedAt = performance.now()
    logConversationPerf('select', {
      conversationId: id,
      cachedMessages: messages.value[id]?.length ?? 0,
      at: new Date().toISOString(),
    })
    activeChannelId.value = id
    saveActiveConversationSelection(id)
    if (activeThreadConversationId.value !== id) {
      closeThread()
    }
    void ensureConversationHistory(id, selectStartedAt)
    const ch = channels.value.find(c => c.id === id)
    if (ch) {
      if (ch.unread > 0 && typeof ch.lastMessageSeq === 'bigint' && ch.lastMessageSeq > 0n) {
        requestReadMark(ch.id, ch.lastMessageSeq)
      }
    }
    const dm = directMessages.value.find(d => d.id === id)
    if (dm) {
      if (dm.unread > 0 && typeof dm.lastMessageSeq === 'bigint' && dm.lastMessageSeq > 0n) {
        requestReadMark(dm.id, dm.lastMessageSeq)
      }
    }
  }

  function registerUserName(userId: string, displayName: string) {
    const normalized = displayName.trim()
    if (!normalized) return
    userNames.value[userId] = normalized
  }

  function resolveDisplayName(userId: string): string {
    const directDisplayName = directMessages.value.find(dm => dm.userId === userId)?.displayName?.trim()
    const selfDisplayName = workspace.value?.selfUserId === userId
      ? workspace.value?.selfDisplayName?.trim()
      : ''
    return userNames.value[userId]
      || directDisplayName
      || selfDisplayName
      || userId.slice(0, 8)
  }

  function resolveAvatarUrl(userId: string): string {
    const fromDirectory = (userAvatars.value[userId] ?? '').trim()
    if (fromDirectory) return fromDirectory
    const fromDm = (directMessages.value.find(dm => dm.userId === userId)?.avatarUrl ?? '').trim()
    if (fromDm) return fromDm
    if (workspace.value?.selfUserId === userId) {
      return (workspace.value.selfAvatarUrl ?? '').trim()
    }
    return ''
  }

  function registerUserIdentity(userId: string, displayName?: string, email?: string, avatarUrl?: string) {
    const normalizedName = (displayName ?? '').trim()
    const normalizedEmail = (email ?? '').trim()
    const normalizedAvatar = (avatarUrl ?? '').trim()
    const resolved = normalizedName || normalizedEmail
    if (resolved) {
      userNames.value[userId] = resolved
    }
    if (normalizedAvatar || avatarUrl === '') {
      userAvatars.value[userId] = normalizedAvatar
    }
  }

  function refreshSenderLabels(userId: string) {
    const resolved = resolveDisplayName(userId)
    const resolvedAvatar = resolveAvatarUrl(userId)
    for (const conversationId of Object.keys(messages.value)) {
      const list = messages.value[conversationId]
      for (const msg of list) {
        if (msg.senderId === userId) {
          msg.senderName = resolved
          msg.senderAvatarUrl = resolvedAvatar
        }
      }
    }
    for (const rootId of Object.keys(threadMessages.value)) {
      const list = threadMessages.value[rootId]
      for (const msg of list) {
        if (msg.senderId === userId) {
          msg.senderName = resolved
          msg.senderAvatarUrl = resolvedAvatar
        }
      }
    }
    const dm = directMessages.value.find(item => item.userId === userId)
    if (dm) {
      dm.displayName = resolved
      dm.avatarUrl = resolvedAvatar
    }
    if (workspace.value?.selfUserId === userId) {
      workspace.value.selfDisplayName = resolved
      workspace.value.selfAvatarUrl = resolvedAvatar
    }
  }

  async function ensureUserDirectory() {
    if (userDirectoryHydrated) return
    if (userDirectoryPromise) return userDirectoryPromise
    userDirectoryPromise = (async () => {
      try {
        const candidates = await listDmCandidates()
        for (const candidate of candidates) {
          registerUserIdentity(candidate.user_id, candidate.display_name, candidate.email, candidate.avatar_url)
        }
        userDirectoryHydrated = true
      } catch {
        // Non-fatal: keep short-id fallback if directory fetch fails.
      } finally {
        userDirectoryPromise = null
      }
    })()
    return userDirectoryPromise
  }

  function addOptimisticMessage(msg: Message) {
    if (!messages.value[msg.channelId]) messages.value[msg.channelId] = []
    messages.value[msg.channelId].push(msg)
  }

  function reconcileMessage(channelId: string, clientMsgId: string, ack: SendMessageAck) {
    const list = messages.value[channelId]
    if (!list) return
    const idx = list.findIndex(m => m.clientMsgId === clientMsgId && m.pending)
    if (idx === -1) return
    const existing = list[idx]
    list.splice(idx, 1, {
      ...existing,
      id: ack.messageId,
      channelSeq: ack.channelSeq,
      createdAt: ack.createdAt ? new Date(Number(ack.createdAt.seconds) * 1000).toISOString() : existing.createdAt,
      pending: false,
    })
  }

  function reconcileThreadMessage(_channelId: string, clientMsgId: string, ack: SendMessageAck) {
    // SendMessageAck does not include thread_seq; we reconcile identity/timestamps here
    // and rely on the subsequent message_created event as the authoritative thread order.
    for (const rootId of Object.keys(threadMessages.value)) {
      const list = threadMessages.value[rootId]
      const idx = list.findIndex(m => m.clientMsgId === clientMsgId && m.pending)
      if (idx === -1) continue
      const duplicate = list.findIndex((m, i) => i !== idx && m.id === ack.messageId)
      if (duplicate !== -1) {
        list.splice(idx, 1)
        return
      }
      const existing = list[idx]
      list.splice(idx, 1, {
        ...existing,
        id: ack.messageId,
        channelSeq: ack.channelSeq,
        createdAt: ack.createdAt ? new Date(Number(ack.createdAt.seconds) * 1000).toISOString() : existing.createdAt,
        pending: false,
      })
      return
    }
  }

  function openThread(rootMessage: Message) {
    if (rootMessage.threadRootMessageId) return
    activeThreadConversationId.value = rootMessage.channelId
    activeThreadRootId.value = rootMessage.id
    const cachedReplies = threadMessages.value[rootMessage.id] ?? []
    if (!threadMessages.value[rootMessage.id]) threadMessages.value[rootMessage.id] = []
    // Subscribe from cached replay progress only. Summary-only state can exist
    // after refresh and must not suppress replay delivery.
    const lastKnownSeq = cachedReplies.reduce((max, message) => {
      if (message.pending) return max
      return message.threadSeq > max ? message.threadSeq : max
    }, 0n)
    useWsStore().sendSubscribeThread(rootMessage.channelId, rootMessage.id, lastKnownSeq)
  }

  function closeThread() {
    activeThreadRootId.value = ''
    activeThreadConversationId.value = ''
  }

  function sendThreadReply(body: string, attachmentIds: string[] = [], attachments: MessageAttachment[] = []) {
    const text = body.trim()
    if (!text && attachmentIds.length === 0) return
    if (!isThreadPanelOpen.value) return
    const channelId = activeThreadConversationId.value
    const rootId = activeThreadRootId.value
    if (!channelId || !rootId) return
    const ws = useWsStore()
    if ((ws.state === 'DISCONNECTED' || ws.state === 'CONNECTING') && attachmentIds.length > 0) return

    const authStore = useAuthStore()
    const senderId = authStore.user?.id ?? workspace.value?.selfUserId ?? ''
    if (!senderId) return
    const senderName = (
      (authStore.user?.displayName?.trim() || '')
      || (workspace.value?.selfDisplayName?.trim() || '')
      || (authStore.user?.email?.trim() || '')
      || senderId.slice(0, 8)
    )

    const clientMsgId = generateId()
    const now = new Date().toISOString()
    const nextThreadSeq = (threadSummaries.value[rootId]?.lastThreadSeq ?? 0n) + 1n

    _upsertThreadMessage(rootId, {
      id: clientMsgId,
      channelId,
      senderId,
      senderName,
      body: text,
      channelSeq: 0n,
      threadSeq: nextThreadSeq,
      threadRootMessageId: rootId,
      mentionedUserIds: [],
      mentionEveryone: false,
      createdAt: now,
      reactions: [],
      myReactions: [],
      attachments,
      clientMsgId,
      pending: true,
    })

    const known = threadSummaries.value[rootId]
    upsertThreadSummary(rootId, {
      replyCount: Math.max(known?.replyCount ?? 0, Number(nextThreadSeq)),
      lastThreadSeq: nextThreadSeq,
      lastReplyAt: now,
      lastReplyUserId: senderId,
    })

    if (ws.state === 'DISCONNECTED' || ws.state === 'CONNECTING') {
      // Lazy-import to avoid circular deps — queue for delivery after reconnect
      import('@/composables/useOfflineQueue').then(({ useOfflineQueue }) => {
        useOfflineQueue().enqueue({ conversationId: channelId, body: text, clientMsgId, threadRootMessageId: rootId })
      })
    } else {
      ws.sendMessage(channelId, text, clientMsgId, rootId, attachmentIds)
    }
  }

  function hasUsableSnapshot(): boolean {
    return bootstrapped.value && (channels.value.length > 0 || directMessages.value.length > 0 || workspace.value !== null)
  }

  function startRealtimeFlow() {
    const ws = useWsStore()
    const auth = ws.authResult
    if (!auth) return

    if (!hasUsableSnapshot() || lastAppliedEventSeq.value === 0n) {
      startBootstrap()
      return
    }

    if (auth.persistedEventSeq > lastAppliedEventSeq.value) {
      ws.setStaleRebootstrap()
      startBootstrap()
      return
    }

    // A local watermark ahead of the server's persisted cursor is expected
    // when the client has applied events that have not been acked yet. SyncSince
    // from the local watermark is still safe: the server returns either an empty
    // tail or the small contiguous suffix the client has not seen.
    ws.sendSyncSince(lastAppliedEventSeq.value, DEFAULT_SYNC_BATCH)
  }

  function startBootstrap() {
    const ws = useWsStore()
    bootstrapStage = null
    bufferedServerEvents = []
    ws.sendBootstrap({
      clientInstanceId,
      pageSizeHint: DEFAULT_SYNC_BATCH,
    })
  }

  function handleBootstrapResponse(resp: BootstrapResponse) {
    if (resp.pageIndex === 0) {
      const authStore = useAuthStore()
      const resolvedRole = workspaceRoleToSlug(resp.userRole || resp.workspace?.selfRole || WorkspaceRole.UNSPECIFIED)
      if (resolvedRole) {
        authStore.setSessionRole(resolvedRole)
      }
    }

    if (resp.pageIndex === 0) {
      bootstrapStage = {
        snapshotSeq: resp.snapshotSeq,
        workspace: resp.workspace ? {
          id: resp.workspace.workspaceId,
          name: resp.workspace.workspaceName,
          selfUserId: resp.workspace.selfUser?.userId ?? '',
          selfDisplayName: resp.workspace.selfUser?.displayName ?? '',
          selfAvatarUrl: resp.workspace.selfUser?.avatarUrl ?? '',
          selfRole: workspaceRoleToSlug(resp.userRole || resp.workspace.selfRole),
        } : null,
        conversations: [],
        notifications: [],
        activeCalls: [],
        pendingInvites: [],
        unread: new Map(),
        presence: new Map(),
      }
    }
    if (!bootstrapStage) {
      console.warn('bootstrap continuation received without an active bootstrap stage', { pageIndex: resp.pageIndex })
      return
    }

    for (const conversation of resp.conversations) {
      bootstrapStage.conversations.push(conversation)
    }
    for (const counter of resp.unread) {
      bootstrapStage.unread.set(counter.conversationId, {
        unreadMessages: counter.unreadMessages,
        unreadMentions: counter.unreadMentions,
        hasUnreadThreadReplies: counter.hasUnreadThreadReplies,
      })
    }
    for (const item of resp.presence) {
      bootstrapStage.presence.set(item.userId, item)
    }
    if (resp.pageIndex === 0) {
      bootstrapStage.notifications = resp.notifications.slice()
      bootstrapStage.activeCalls = resp.activeCalls.slice()
      bootstrapStage.pendingInvites = resp.pendingInvites.slice()
    }

    if (resp.hasMore) {
      const ws = useWsStore()
      ws.sendBootstrap({
        clientInstanceId,
        bootstrapSessionId: resp.bootstrapSessionId,
        pageToken: resp.nextPageToken,
      })
      return
    }

    applyBootstrapSnapshot(bootstrapStage)
    lastAppliedEventSeq.value = resp.snapshotSeq
    saveLastAppliedEventSeq(lastAppliedEventSeq.value)
    if (activeChannelId.value) {
      void ensureConversationHistory(activeChannelId.value)
    }
    scheduleAckFlush()
    const ws = useWsStore()
    ws.setLiveSynced()
    drainBufferedEvents()
  }

  function applyBootstrapSnapshot(stage: BootstrapStage) {
    const unreadByConversation = stage.unread
    const nextChannels: Channel[] = []
    const nextDms: DirectMessage[] = []

    presenceByUserId.value = {}
    for (const [userId, evt] of stage.presence.entries()) {
      presenceByUserId.value[userId] = evt
    }

    for (const summary of stage.conversations) {
      const unread = unreadByConversation.get(summary.conversationId)?.unreadMessages ?? 0
      const hasUnreadThreadReplies = unreadByConversation.get(summary.conversationId)?.hasUnreadThreadReplies ?? false
      if (summary.conversationType === ConversationType.DM) {
        registerUserName(summary.topic || summary.conversationId, summary.title)
        nextDms.push({
          id: summary.conversationId,
          userId: summary.topic || summary.conversationId,
          displayName: summary.title,
          avatarUrl: resolveAvatarUrl(summary.topic || summary.conversationId),
          presence: summary.presence === PresenceStatus.ONLINE
            ? 'online'
            : summary.presence === PresenceStatus.AWAY
              ? 'away'
              : 'offline',
          unread,
          hasUnreadThreadReplies,
          lastMessageSeq: summary.lastMessageSeq,
        })
      } else {
        nextChannels.push({
          id: summary.conversationId,
          name: summary.title,
          kind: 'channel',
          visibility: summary.conversationType === ConversationType.CHANNEL_PRIVATE ? 'private' : 'public',
          unread,
          hasUnreadThreadReplies,
          lastMessageSeq: summary.lastMessageSeq,
          lastActivityAt: summary.lastActivityAt
            ? new Date(Number(summary.lastActivityAt.seconds) * 1000).toISOString()
            : undefined,
        })
      }
    }

    workspace.value = stage.workspace
    if (stage.workspace?.selfUserId) {
      registerUserIdentity(
        stage.workspace.selfUserId,
        stage.workspace.selfDisplayName,
        undefined,
        stage.workspace.selfAvatarUrl ?? '',
      )
    }
    channels.value = nextChannels
    directMessages.value = nextDms
    // Bootstrap conversation summaries do not carry peer avatar URLs.
    // Hydrate the identity directory after snapshot apply and refresh visible
    // sender/DM labels so avatars persist across full page reloads.
    void ensureUserDirectory().then(() => {
      for (const dm of directMessages.value) {
        refreshSenderLabels(dm.userId)
      }
    })
    notifications.value = stage.notifications.map(notificationSummaryToItem)
    activeCalls.value = stage.activeCalls.map(activeCallSummaryToItem)
    pendingInvites.value = stage.pendingInvites.map(callInviteSummaryToItem)
    messages.value = {}
    conversationHistoryState.clear()
    conversationInitialLoadingById.value = {}
    historyLoadTokenByConversation.clear()
    threadMessages.value = {}
    threadSummaries.value = loadThreadSummariesForUser(stage.workspace?.selfUserId ?? '')
    activeThreadRootId.value = ''
    activeThreadConversationId.value = ''
    bootstrapped.value = true
    seenEventIds = new Set()

    const restoredConversation = resolveSnapshotActiveConversation(nextChannels, nextDms, stage.workspace)
    activeChannelId.value = restoredConversation
    if (restoredConversation) {
      saveActiveConversationSelection(restoredConversation)
    } else {
      clearActiveConversationSelection()
    }
  }

  async function ensureConversationHistory(conversationId: string, selectStartedAt?: number) {
    if (!conversationId) return
    const state = getOrCreateHistoryState(conversationId)
    if (state.initialized) {
      if (conversationInitialLoadingById.value[conversationId]) {
        conversationInitialLoadingById.value = {
          ...conversationInitialLoadingById.value,
          [conversationId]: false,
        }
      }
      const cached = messages.value[conversationId] ?? []
      logConversationPerf('history:cache-hit', {
        conversationId,
        messages: cached.length,
        totalSinceSelectMs: typeof selectStartedAt === 'number'
          ? Math.round((performance.now() - selectStartedAt) * 100) / 100
          : undefined,
      })
      return
    }

    await loadConversationHistoryPage(conversationId, undefined, selectStartedAt)
  }

  async function loadOlderConversationHistory(conversationId: string): Promise<number> {
    if (!conversationId) return 0
    const state = getOrCreateHistoryState(conversationId)
    if (!state.initialized || !state.hasMore || state.loading || typeof state.nextBeforeChannelSeq !== 'bigint') {
      return 0
    }
    return loadConversationHistoryPage(conversationId, state.nextBeforeChannelSeq)
  }

  async function loadConversationHistoryPage(
    conversationId: string,
    beforeChannelSeq?: bigint,
    selectStartedAt?: number,
  ): Promise<number> {
    const state = getOrCreateHistoryState(conversationId)
    if (state.loading) return 0

    const token = ++historyLoadToken
    historyLoadTokenByConversation.set(conversationId, token)
    state.loading = true
    const isInitialLoad = !state.initialized
    if (isInitialLoad) {
      conversationInitialLoadingById.value = {
        ...conversationInitialLoadingById.value,
        [conversationId]: true,
      }
    }

    const requestStartedAt = performance.now()
    logConversationPerf('history:request:start', {
      conversationId,
      token,
      beforeChannelSeq: typeof beforeChannelSeq === 'bigint' ? beforeChannelSeq.toString() : undefined,
    })
    try {
      const page = await listConversationMessages(conversationId, beforeChannelSeq)
      const requestMs = Math.round((performance.now() - requestStartedAt) * 100) / 100
      logConversationPerf('history:request:done', {
        conversationId,
        token,
        requestMs,
        count: page.messages.length,
        hasMore: page.has_more,
      })
      if (token !== historyLoadTokenByConversation.get(conversationId)) {
        logConversationPerf('history:request:stale', {
          conversationId,
          token,
          currentToken: historyLoadTokenByConversation.get(conversationId) ?? 0,
        })
        return 0
      }
      const applyStartedAt = performance.now()
      applyConversationHistory(conversationId, page.messages)
      state.initialized = true
      state.hasMore = page.has_more
      if (page.next_before_channel_seq) {
        state.nextBeforeChannelSeq = BigInt(page.next_before_channel_seq)
      } else if (page.messages.length > 0) {
        state.nextBeforeChannelSeq = BigInt(page.messages[0].channel_seq)
      } else {
        state.nextBeforeChannelSeq = undefined
      }
      const applyMs = Math.round((performance.now() - applyStartedAt) * 100) / 100
      logConversationPerf('history:apply:done', {
        conversationId,
        token,
        applyMs,
        totalSinceSelectMs: typeof selectStartedAt === 'number'
          ? Math.round((performance.now() - selectStartedAt) * 100) / 100
          : undefined,
      })
      return page.messages.length
    } catch {
      // Keep the shell usable; history reload can fail independently from WS state.
      logConversationPerf('history:request:error', {
        conversationId,
        token,
      })
      return 0
    } finally {
      if (token === historyLoadTokenByConversation.get(conversationId)) {
        state.loading = false
      }
      if (isInitialLoad) {
        conversationInitialLoadingById.value = {
          ...conversationInitialLoadingById.value,
          [conversationId]: false,
        }
      }
    }
  }

  function handleSyncSinceResponse(resp: SyncSinceResponse) {
    const ws = useWsStore()
    if (resp.needFullBootstrap) {
      ws.setStaleRebootstrap()
      startBootstrap()
      return
    }

    if (resp.events.length === 0) {
      ws.setLiveSynced()
      drainBufferedEvents()
      _reloadActiveChannelHistory()
      return
    }

    for (const event of resp.events) {
      if (!applyContiguousEvent(event)) {
        ws.setStaleRebootstrap()
        startBootstrap()
        return
      }
    }

    if (resp.events.length >= DEFAULT_SYNC_BATCH) {
      ws.sendSyncSince(lastAppliedEventSeq.value, DEFAULT_SYNC_BATCH)
      return
    }

    ws.setLiveSynced()
    drainBufferedEvents()
    _reloadActiveChannelHistory()
  }

  /**
   * After a syncSince reconnect, the active channel's cached history may be
   * stale (e.g. the user switched channels while disconnected, or offline
   * messages were just flushed). Invalidate and reload so the user always
   * sees a fresh, complete history after reconnect.
   */
  function _reloadActiveChannelHistory() {
    const conversationId = activeChannelId.value
    if (!conversationId) return
    // Invalidate the cache so ensureConversationHistory fetches fresh data
    const state = conversationHistoryState.get(conversationId)
    if (state) {
      state.initialized = false
    }
    void ensureConversationHistory(conversationId)
  }

  function handleAckResponse(resp: AckResponse) {
    if (!resp.ok) return
    lastAckedEventSeq.value = resp.persistedEventSeq
    pendingAckEventCount = 0
  }

  function handleReadCursorAck(ack: ReadCursorAck) {
    const targetChannel = channels.value.find(channel => channel.id === ack.conversationId)
    if (targetChannel) targetChannel.unread = 0
    const targetDm = directMessages.value.find(dm => dm.id === ack.conversationId)
    if (targetDm) targetDm.unread = 0
  }

  function handlePresenceEvent(evt: PresenceEvent) {
    presenceByUserId.value[evt.userId] = evt
    const targetDm = directMessages.value.find(dm => dm.userId === evt.userId)
    if (targetDm) {
      targetDm.presence = evt.effectivePresence === PresenceStatus.ONLINE
        ? 'online'
        : evt.effectivePresence === PresenceStatus.AWAY
          ? 'away'
          : 'offline'
    }
  }

  function handleTypingEvent(evt: { conversationId: string; userId: string; expiresAt?: { seconds: bigint | string | number } | undefined; isTyping: boolean }) {
    if (!userNames.value[evt.userId]) {
      void ensureUserDirectory()
    }

    const existing = typingByConversationId.value[evt.conversationId] ?? []
    const next = existing.filter(entry => entry.userId !== evt.userId)
    if (evt.isTyping) {
      next.push({
        userId: evt.userId,
        expiresAt: evt.expiresAt ? new Date(Number(evt.expiresAt.seconds) * 1000).toISOString() : undefined,
      })
    }
    typingByConversationId.value[evt.conversationId] = next
  }

  function handleServerEvent(evt: ServerEvent) {
    if (isDirectImmediateEvent(evt)) {
      applyServerEventPayload(evt)
      return
    }
    const ws = useWsStore()
    if (ws.state === 'BOOTSTRAPPING' || ws.state === 'RECOVERING_GAP' || ws.state === 'STALE_REBOOTSTRAP' || !bootstrapped.value) {
      bufferServerEvent(evt)
      return
    }
    applySequencedEvent(evt)
  }

  function handleSendMessageAck(ack: SendMessageAck) {
    reconcileMessage(ack.conversationId, ack.clientMsgId, ack)
    reconcileThreadMessage(ack.conversationId, ack.clientMsgId, ack)
  }

  function handleReactionAck(ack: ReactionAck) {
    if (DEBUG_REACTIONS) {
      console.debug('[reactions][store] handleReactionAck', ack)
    }
    const op = pendingReactionOps.value[ack.clientOpId]
    if (!op) return
    clearTimeout(op.timeout)
    delete pendingReactionOps.value[ack.clientOpId]
    if (!ack.ok || !ack.applied) {
      rollbackReactionOp(op)
    }
  }

  function handleSubscribeThreadResponse(resp: SubscribeThreadResponse) {
    const root = resp.threadRootMessageId
    if (!threadMessages.value[root]) threadMessages.value[root] = []
    for (const evt of resp.replay) {
      _upsertThreadMessage(root, _messageEventToMessage(evt, evt.conversationId))
    }
    const currentThreadSeq = resp.currentThreadSeq
    const currentReplyCount = Number(currentThreadSeq)
    upsertThreadSummary(root, {
      replyCount: Math.max(threadSummaries.value[root]?.replyCount ?? 0, currentReplyCount),
      lastThreadSeq: threadSummaries.value[root]?.lastThreadSeq && threadSummaries.value[root].lastThreadSeq > currentThreadSeq
        ? threadSummaries.value[root].lastThreadSeq
        : currentThreadSeq,
      lastReplyAt: threadSummaries.value[root]?.lastReplyAt,
      lastReplyUserId: threadSummaries.value[root]?.lastReplyUserId,
    })
  }

  function registerWsHandlers() {
    const ws = useWsStore()
    ws.onServerEvent(handleServerEvent)
    ws.onSendMessageAck(handleSendMessageAck)
    ws.onReactionAck(handleReactionAck)
    ws.onSubscribeThreadResponse(handleSubscribeThreadResponse)
    ws.onBootstrapResponse(handleBootstrapResponse)
    ws.onSyncSinceResponse(handleSyncSinceResponse)
    ws.onAckResponse(handleAckResponse)
    ws.onReadCursorAck(handleReadCursorAck)
    ws.onPresenceEvent(handlePresenceEvent)
    ws.onTypingEvent(handleTypingEvent)
  }

  function addMessage(msg: Message) {
    if (!messages.value[msg.channelId]) messages.value[msg.channelId] = []
    messages.value[msg.channelId].push(msg)
    incrementUnread(msg.channelId)
  }

  function queueReactionOp(clientOpId: string, channelId: string, messageId: string, emoji: string, op: 'add' | 'remove') {
    if (DEBUG_REACTIONS) {
      console.debug('[reactions][store] queueReactionOp', { clientOpId, channelId, messageId, emoji, op })
    }
    const msg = _findMessage(channelId, messageId)
    if (!msg) return
    applyOptimisticReaction(msg, emoji, op)

    const timeout = setTimeout(() => {
      const current = pendingReactionOps.value[clientOpId]
      if (!current) return
      delete pendingReactionOps.value[clientOpId]
      rollbackReactionOp(current)
    }, REACTION_OP_TIMEOUT_MS)

    pendingReactionOps.value[clientOpId] = {
      channelId,
      messageId,
      emoji,
      op,
      timeout,
    }
  }

  function rollbackReactionOp(op: PendingReactionOp) {
    if (DEBUG_REACTIONS) {
      console.debug('[reactions][store] rollbackReactionOp', op)
    }
    const msg = _findMessage(op.channelId, op.messageId)
    if (!msg) return
    if (op.op === 'add') {
      applyOptimisticReaction(msg, op.emoji, 'remove')
    } else {
      applyOptimisticReaction(msg, op.emoji, 'add')
    }
    showToast('Reaction failed. Try again.')
  }

  function applyOptimisticReaction(msg: Message, emoji: string, op: 'add' | 'remove') {
    const mine = msg.myReactions.includes(emoji)
    const idx = msg.reactions.findIndex(reaction => reaction.emoji === emoji)
    if (op === 'add') {
      if (mine) return
      _setMyReaction(msg, emoji, true)
      if (idx === -1) {
        msg.reactions.push({ emoji, count: 1 })
      } else {
        msg.reactions[idx].count += 1
      }
      return
    }
    if (!mine) return
    _setMyReaction(msg, emoji, false)
    if (idx === -1) return
    const nextCount = msg.reactions[idx].count - 1
    if (nextCount <= 0) {
      msg.reactions.splice(idx, 1)
      return
    }
    msg.reactions[idx].count = nextCount
  }

  function isReactionOpPending(channelId: string, messageId: string, emoji: string): boolean {
    return Object.values(pendingReactionOps.value).some(op =>
      op.channelId === channelId
      && op.messageId === messageId
      && op.emoji === emoji
    )
  }

  function showToast(message: string) {
    const id = Date.now()
    toast.value = { id, message }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      if (toast.value?.id === id) {
        toast.value = null
      }
    }, TOAST_DURATION_MS)
  }

  function bufferServerEvent(evt: ServerEvent) {
    if (evt.eventId && bufferedServerEvents.some(existing => existing.eventId === evt.eventId)) return
    bufferedServerEvents.push(evt)
    bufferedServerEvents.sort((a, b) => Number(a.eventSeq - b.eventSeq))
    if (bufferedServerEvents.length > MAX_BUFFERED_SERVER_EVENTS) {
      bufferedServerEvents = bufferedServerEvents.slice(-MAX_BUFFERED_SERVER_EVENTS)
    }
  }

  function drainBufferedEvents() {
    if (bufferedServerEvents.length === 0) return
    const ws = useWsStore()
    const queued = bufferedServerEvents.slice()
    bufferedServerEvents = []
    for (const evt of queued) {
      applySequencedEvent(evt)
      if (ws.state === 'RECOVERING_GAP' || ws.state === 'STALE_REBOOTSTRAP') {
        break
      }
    }
  }

  function applySequencedEvent(evt: ServerEvent) {
    const ws = useWsStore()
    if (evt.eventSeq <= lastAppliedEventSeq.value) return
    if (evt.eventSeq > lastAppliedEventSeq.value + 1n) {
      bufferServerEvent(evt)
      ws.setRecoveringGap()
      ws.sendSyncSince(lastAppliedEventSeq.value, DEFAULT_SYNC_BATCH)
      return
    }
    applyContiguousEvent(evt)
  }

  function applyContiguousEvent(evt: ServerEvent): boolean {
    if (evt.eventSeq <= lastAppliedEventSeq.value) return true
    if (evt.eventSeq !== lastAppliedEventSeq.value + 1n) return false
    if (evt.eventId && seenEventIds.has(evt.eventId)) {
      lastAppliedEventSeq.value = evt.eventSeq
      saveLastAppliedEventSeq(lastAppliedEventSeq.value)
      return true
    }

    applyServerEventPayload(evt)

    if (evt.eventId) {
      seenEventIds.add(evt.eventId)
      if (seenEventIds.size > 512) {
        const ids = Array.from(seenEventIds).slice(-256)
        seenEventIds = new Set(ids)
      }
    }
    lastAppliedEventSeq.value = evt.eventSeq
    saveLastAppliedEventSeq(lastAppliedEventSeq.value)
    pendingAckEventCount += 1
    scheduleAckFlush()
    return true
  }

  function scheduleAckFlush() {
    const ws = useWsStore()
    if (pendingAckEventCount >= ACK_BATCH_SIZE && lastAppliedEventSeq.value > lastAckedEventSeq.value) {
      ws.sendAck(lastAppliedEventSeq.value)
      return
    }
    if (ackTimer) return
    ackTimer = setTimeout(() => {
      ackTimer = null
      if (lastAppliedEventSeq.value > lastAckedEventSeq.value) {
        ws.sendAck(lastAppliedEventSeq.value)
      }
    }, ACK_INTERVAL_MS)
  }

  function applyServerEventPayload(evt: ServerEvent) {
    switch (evt.payload.case) {
      case 'messageCreated':
        _onMessageCreated(evt.payload.value)
        break
      case 'threadSummaryUpdated':
        _onThreadSummaryUpdated(evt.payload.value)
        break
      case 'reactionUpdated':
        _onReactionUpdated(evt.payload.value)
        break
      case 'conversationUpserted':
        applyConversationSummary(evt.payload.value.conversation)
        break
      case 'conversationRemoved':
        removeConversation(evt.payload.value.conversationId)
        break
      case 'readCounterUpdated':
        applyReadCounterUpdate(evt.payload.value)
        break
      case 'notificationAdded':
        applyNotificationAdded(evt.payload.value)
        break
      case 'notificationResolved':
        notifications.value = notifications.value.filter(item => item.id !== (evt.payload.value as NotificationResolvedEvent).notificationId)
        break
      case 'callStateChanged':
        applyCallStateChanged(evt.payload.value)
        break
      case 'callInviteCreated':
        applyInviteCreated(evt.payload.value)
        break
      case 'callInviteCancelled':
        pendingInvites.value = pendingInvites.value.filter(item => item.id !== (evt.payload.value as CallInviteCancelledEvent).inviteId)
        break
      case 'forcePasswordChange':
        useAuthStore().setNeedChangePassword(true)
        break
      case 'userIdentityUpdated':
        applyUserIdentityUpdated(evt.payload.value)
        break
      default:
        break
    }
  }

  function isDirectImmediateEvent(evt: ServerEvent): boolean {
    if (evt.eventSeq !== 0n) return false
    return evt.payload.case === 'conversationUpserted'
      || evt.payload.case === 'conversationRemoved'
      || evt.payload.case === 'readCounterUpdated'
      || evt.payload.case === 'notificationAdded'
      || evt.payload.case === 'notificationResolved'
      || evt.payload.case === 'callInviteCreated'
      || evt.payload.case === 'callInviteCancelled'
      || evt.payload.case === 'forcePasswordChange'
  }

  function applyConversationSummary(summary?: ConversationSummary) {
    if (!summary) return
    const unread = currentUnread(summary.conversationId)
    const hasUnreadThreadReplies = currentHasUnreadThreadReplies(summary.conversationId)
    if (summary.conversationType === ConversationType.DM) {
      registerUserName(summary.topic || summary.conversationId, summary.title)
      const next: DirectMessage = {
        id: summary.conversationId,
        userId: summary.topic || summary.conversationId,
        displayName: summary.title,
        avatarUrl: resolveAvatarUrl(summary.topic || summary.conversationId),
        presence: summary.presence === PresenceStatus.ONLINE
          ? 'online'
          : summary.presence === PresenceStatus.AWAY
              ? 'away'
              : 'offline',
        unread,
        hasUnreadThreadReplies,
        lastMessageSeq: summary.lastMessageSeq,
      }
      upsertDirectMessage(next)
      return
    }

    const next: Channel = {
      id: summary.conversationId,
      name: summary.title,
      kind: 'channel',
      visibility: summary.conversationType === ConversationType.CHANNEL_PRIVATE ? 'private' : 'public',
      unread,
      hasUnreadThreadReplies,
      lastMessageSeq: summary.lastMessageSeq,
      lastActivityAt: summary.lastActivityAt
        ? new Date(Number(summary.lastActivityAt.seconds) * 1000).toISOString()
        : undefined,
    }
    upsertChannel(next)
  }

  function applyReadCounterUpdate(evt: ReadCounterUpdatedEvent) {
    const counter = evt.counter
    if (!counter) return
    const targetChannel = channels.value.find(channel => channel.id === counter.conversationId)
    if (targetChannel) {
      targetChannel.unread = counter.unreadMessages
      targetChannel.hasUnreadThreadReplies = counter.hasUnreadThreadReplies
    }
    const targetDm = directMessages.value.find(dm => dm.id === counter.conversationId)
    if (targetDm) {
      targetDm.unread = counter.unreadMessages
      targetDm.hasUnreadThreadReplies = counter.hasUnreadThreadReplies
    }
  }

  function applyNotificationAdded(evt: NotificationAddedEvent) {
    if (!evt.notification) return
    notifications.value = [
      notificationSummaryToItem(evt.notification),
      ...notifications.value.filter(item => item.id !== evt.notification?.notificationId),
    ]
    const conversationId = evt.notification.conversationId
    if (!conversationId) return
    if (conversationExists(conversationId)) return
    const ws = useWsStore()
    if (ws.state === 'BOOTSTRAPPING' || ws.state === 'RECOVERING_GAP' || ws.state === 'STALE_REBOOTSTRAP') return
    startBootstrap()
  }

  function applyCallStateChanged(evt: CallStateChangedEvent) {
    activeCalls.value = activeCalls.value.filter(call => call.id !== evt.callId)
    if (evt.status === CallStatus.ACTIVE) {
      activeCalls.value.unshift({
        id: evt.callId,
        conversationId: evt.conversationId,
        status: evt.status.toString(),
        participantCount: 0,
      })
    }
  }

  function applyInviteCreated(evt: CallInviteCreatedEvent) {
    if (!evt.invite) return
    pendingInvites.value = [
      callInviteSummaryToItem(evt.invite),
      ...pendingInvites.value.filter(item => item.id !== evt.invite?.inviteId),
    ]
  }

  function applyUserIdentityUpdated(evt: { userId: string; displayName: string; avatarUrl: string }) {
    registerUserIdentity(evt.userId, evt.displayName, undefined, evt.avatarUrl)
    refreshSenderLabels(evt.userId)
  }

  function removeConversation(conversationId: string) {
    const authStore = useAuthStore()
    const workspaceId = workspace.value?.id || workspace.value?.name || ''
    const userId = workspace.value?.selfUserId || authStore.user?.id || ''
    const persisted = loadLastOpenedConversation(workspaceId, userId)
    if (persisted === conversationId) {
      clearActiveConversationSelection()
    }
    channels.value = channels.value.filter(channel => channel.id !== conversationId)
    directMessages.value = directMessages.value.filter(dm => dm.id !== conversationId)
    pendingReadByConversation.delete(conversationId)
    conversationHistoryState.delete(conversationId)
    historyLoadTokenByConversation.delete(conversationId)
    const nextInitialLoading = { ...conversationInitialLoadingById.value }
    delete nextInitialLoading[conversationId]
    conversationInitialLoadingById.value = nextInitialLoading
    delete messages.value[conversationId]
    if (activeThreadConversationId.value === conversationId) {
      closeThread()
    }
    if (activeChannelId.value === conversationId) {
      const fallbackConversation = firstPublicChannelId(channels.value)
      activeChannelId.value = fallbackConversation
      if (fallbackConversation) {
        saveActiveConversationSelection(fallbackConversation)
      } else {
        clearActiveConversationSelection()
      }
    }
  }

  function removeConversationLocal(conversationId: string) {
    removeConversation(conversationId)
  }

  function upsertChannel(channel: Channel) {
    if (!messages.value[channel.id]) messages.value[channel.id] = []
    const idx = channels.value.findIndex(existing => existing.id === channel.id)
    if (idx === -1) {
      channels.value.unshift(channel)
    } else {
      channels.value.splice(idx, 1, channel)
    }
  }

  function upsertDirectMessage(dm: DirectMessage) {
    const idx = directMessages.value.findIndex(existing => existing.id === dm.id)
    if (idx === -1) {
      directMessages.value.unshift(dm)
    } else {
      directMessages.value.splice(idx, 1, dm)
    }
  }

  function openDirectMessage(dm: DirectMessage) {
    upsertDirectMessage(dm)
    if (!messages.value[dm.id]) messages.value[dm.id] = []
    activeChannelId.value = dm.id
    saveActiveConversationSelection(dm.id)
    closeThread()
    const target = directMessages.value.find(item => item.id === dm.id)
    if (target) target.unread = 0
    void ensureConversationHistory(dm.id)
  }

  function currentUnread(conversationId: string): number {
    return channels.value.find(channel => channel.id === conversationId)?.unread
      ?? directMessages.value.find(dm => dm.id === conversationId)?.unread
      ?? 0
  }

  function currentHasUnreadThreadReplies(conversationId: string): boolean {
    return channels.value.find(channel => channel.id === conversationId)?.hasUnreadThreadReplies
      ?? directMessages.value.find(dm => dm.id === conversationId)?.hasUnreadThreadReplies
      ?? false
  }

  function conversationExists(conversationId: string): boolean {
    return channels.value.some(channel => channel.id === conversationId) || directMessages.value.some(dm => dm.id === conversationId)
  }

  function incrementUnread(conversationId: string) {
    if (conversationId === activeChannelId.value) return
    incrementUnreadDirect(conversationId)
  }

  function incrementUnreadDirect(conversationId: string) {
    const channel = channels.value.find(item => item.id === conversationId)
    if (channel) channel.unread += 1
    const dm = directMessages.value.find(item => item.id === conversationId)
    if (dm) dm.unread += 1
  }

  function _onMessageCreated(evt: ProtoMessageEvent) {
    const channelId = evt.conversationId
    const msg = _messageEventToMessage(evt, channelId)
    const isSelfAuthored = evt.senderId === workspace.value?.selfUserId

    if (evt.threadRootMessageId) {
      const rootId = evt.threadRootMessageId
      _upsertThreadMessage(rootId, msg)
      const known = threadSummaries.value[rootId]
      const nextLastThreadSeq = known?.lastThreadSeq && known.lastThreadSeq > evt.threadSeq
        ? known.lastThreadSeq
        : evt.threadSeq
      upsertThreadSummary(rootId, {
        replyCount: Math.max(known?.replyCount ?? 0, Number(nextLastThreadSeq)),
        lastThreadSeq: nextLastThreadSeq,
        lastReplyAt: msg.createdAt,
        lastReplyUserId: evt.senderId,
      })
      if (!isSelfAuthored) {
        const channel = channels.value.find(item => item.id === channelId)
        if (channel) channel.hasUnreadThreadReplies = true
        const dm = directMessages.value.find(item => item.id === channelId)
        if (dm) dm.hasUnreadThreadReplies = true
      }
      return
    }

    if (!messages.value[channelId]) messages.value[channelId] = []
    const alreadyPresent = messages.value[channelId].some(m => m.id === evt.messageId)
    if (alreadyPresent) return

    messages.value[channelId].push(msg)
    const channel = channels.value.find(item => item.id === channelId)
    if (channel) channel.lastMessageSeq = evt.channelSeq
    const dm = directMessages.value.find(item => item.id === channelId)
    if (dm) dm.lastMessageSeq = evt.channelSeq
    if (channelId === activeChannelId.value) {
      if (isClientTabActive()) {
        requestReadMark(channelId, evt.channelSeq)
      } else {
        queuePendingReadMark(channelId, evt.channelSeq)
        if (!isSelfAuthored) incrementUnreadDirect(channelId)
      }
      return
    }
    if (!isSelfAuthored) {
      incrementUnread(channelId)
    }
  }

  function isClientTabActive(): boolean {
    return clientIsActive
  }

  function setClientActive(active: boolean) {
    clientIsActive = active
  }

  function queuePendingReadMark(conversationId: string, lastReadSeq: bigint) {
    const current = pendingReadByConversation.get(conversationId) ?? 0n
    if (lastReadSeq > current) {
      pendingReadByConversation.set(conversationId, lastReadSeq)
    }
  }

  function clearUnreadForConversation(conversationId: string) {
    const channel = channels.value.find(item => item.id === conversationId)
    if (channel) channel.unread = 0
    const dm = directMessages.value.find(item => item.id === conversationId)
    if (dm) dm.unread = 0
  }

  function sendReadMark(conversationId: string, lastReadSeq: bigint) {
    useWsStore().sendUpdateReadCursor(conversationId, lastReadSeq)
    clearUnreadForConversation(conversationId)
    pendingReadByConversation.delete(conversationId)
  }

  function requestReadMark(conversationId: string, lastReadSeq: bigint) {
    if (isClientTabActive()) {
      sendReadMark(conversationId, lastReadSeq)
      return
    }
    queuePendingReadMark(conversationId, lastReadSeq)
  }

  function onClientFocus() {
    if (!isClientTabActive()) return
    const conversationId = activeChannelId.value
    if (!conversationId) return

    const pendingSeq = pendingReadByConversation.get(conversationId)
    if (typeof pendingSeq === 'bigint' && pendingSeq > 0n) {
      sendReadMark(conversationId, pendingSeq)
      return
    }

    const channel = channels.value.find(item => item.id === conversationId)
    if (channel && channel.unread > 0 && typeof channel.lastMessageSeq === 'bigint' && channel.lastMessageSeq > 0n) {
      sendReadMark(conversationId, channel.lastMessageSeq)
      return
    }
    const dm = directMessages.value.find(item => item.id === conversationId)
    if (dm && dm.unread > 0 && typeof dm.lastMessageSeq === 'bigint' && dm.lastMessageSeq > 0n) {
      sendReadMark(conversationId, dm.lastMessageSeq)
    }
  }

  function _onThreadSummaryUpdated(evt: ThreadSummaryUpdatedEvent) {
    const root = evt.threadRootMessageId
    // V1 semantics: replies are append-only (no delete/edit that would decrement totals),
    // so reply_count can be treated as the current terminal thread_seq.
    const eventLastSeq = BigInt(Math.max(Number(evt.replyCount), 0))
    const knownLastSeq = threadSummaries.value[root]?.lastThreadSeq ?? 0n
    const nextLastSeq = knownLastSeq > eventLastSeq ? knownLastSeq : eventLastSeq
    upsertThreadSummary(root, {
      replyCount: Number(nextLastSeq),
      lastThreadSeq: nextLastSeq,
      lastReplyAt: evt.lastThreadReplyAt
        ? new Date(Number(evt.lastThreadReplyAt.seconds) * 1000).toISOString()
        : undefined,
      lastReplyUserId: evt.lastThreadReplyUserId,
    })
  }

  function _onReactionUpdated(evt: ReactionUpdatedEvent) {
    if (DEBUG_REACTIONS) {
      console.debug('[reactions][store] reactionUpdated:event', evt)
    }
    const candidates: Message[] = []
    const list = messages.value[evt.conversationId]
    if (list) {
      const msg = list.find(m => m.id === evt.messageId)
      if (msg) candidates.push(msg)
    }
    for (const rootId of Object.keys(threadMessages.value)) {
      const msg = threadMessages.value[rootId]?.find(item => item.id === evt.messageId)
      if (msg) candidates.push(msg)
    }
    for (const msg of candidates) {
      const idx = msg.reactions.findIndex(r => r.emoji === evt.emoji)
      if (evt.count <= 0) {
        if (idx !== -1) msg.reactions.splice(idx, 1)
      } else if (idx === -1) {
        msg.reactions.push({ emoji: evt.emoji, count: evt.count })
      } else {
        msg.reactions[idx].count = evt.count
      }
    }
  }

  function _upsertThreadMessage(rootId: string, msg: Message) {
    if (!threadMessages.value[rootId]) threadMessages.value[rootId] = []
    const list = threadMessages.value[rootId]
    const existing = list.findIndex(m => m.id === msg.id)
    if (existing === -1) {
      list.push(msg)
    } else {
      list.splice(existing, 1, msg)
    }
    list.sort((a, b) => {
      if (a.threadSeq !== b.threadSeq) return Number(a.threadSeq - b.threadSeq)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
  }

  function _messageEventToMessage(evt: ProtoMessageEvent, channelId: string): Message {
    if (!userNames.value[evt.senderId]) {
      void ensureUserDirectory().then(() => refreshSenderLabels(evt.senderId))
    }
    return {
      id: evt.messageId,
      channelId,
      senderId: evt.senderId,
      senderName: resolveDisplayName(evt.senderId),
      senderAvatarUrl: resolveAvatarUrl(evt.senderId),
      body: evt.body,
      channelSeq: evt.channelSeq,
      threadSeq: evt.threadSeq,
      threadRootMessageId: evt.threadRootMessageId || undefined,
      mentionedUserIds: evt.mentionedUserIds ?? [],
      mentionEveryone: evt.mentionEveryone ?? false,
      createdAt: evt.createdAt
        ? new Date(Number(evt.createdAt.seconds) * 1000).toISOString()
        : new Date().toISOString(),
      reactions: [],
      myReactions: [],
      attachments: (evt.attachments ?? []).map(item => ({
        id: item.attachmentId,
        fileName: item.fileName,
        fileSize: Number(item.fileSize),
        mimeType: item.mimeType,
      })),
      pending: false,
    }
  }

  function applyConversationHistory(conversationId: string, history: ConversationMessageItem[]) {
    const applyStartedAt = performance.now()
    const existing = messages.value[conversationId] ?? []
    const byId = new Map(existing.map(message => [message.id, message]))

    for (const item of history) {
      registerUserIdentity(item.sender_id, item.sender_name)
      if (!userNames.value[item.sender_id]) {
        void ensureUserDirectory().then(() => refreshSenderLabels(item.sender_id))
      }
      byId.set(item.id, {
        id: item.id,
        channelId: item.conversation_id,
        senderId: item.sender_id,
        senderName: item.sender_name || resolveDisplayName(item.sender_id),
        senderAvatarUrl: resolveAvatarUrl(item.sender_id),
        body: item.body,
        channelSeq: BigInt(item.channel_seq),
        threadSeq: BigInt(item.thread_seq),
        threadRootMessageId: item.thread_root_message_id || undefined,
        mentionedUserIds: [],
        mentionEveryone: item.mention_everyone,
        createdAt: item.created_at,
        reactions: item.reactions ?? byId.get(item.id)?.reactions ?? [],
        myReactions: item.my_reactions ?? byId.get(item.id)?.myReactions ?? [],
        attachments: (item.attachments ?? []).map(attachment => ({
          id: attachment.id,
          fileName: attachment.file_name,
          fileSize: attachment.file_size,
          mimeType: attachment.mime_type,
        })),
        pending: false,
      })

      const threadReplyCount = Math.max(0, Math.floor(Number(item.thread_reply_count ?? 0)))
      if (threadReplyCount > 0) {
        const known = threadSummaries.value[item.id]
        const eventLastSeq = BigInt(threadReplyCount)
        const knownLastSeq = known?.lastThreadSeq ?? 0n
        const nextLastSeq = knownLastSeq > eventLastSeq ? knownLastSeq : eventLastSeq
        upsertThreadSummary(item.id, {
          replyCount: Number(nextLastSeq),
          lastThreadSeq: nextLastSeq,
          lastReplyAt: known?.lastReplyAt,
          lastReplyUserId: known?.lastReplyUserId,
        })
      }
    }

    messages.value[conversationId] = Array.from(byId.values()).sort((a, b) => Number(a.channelSeq - b.channelSeq))
    const applyMs = Math.round((performance.now() - applyStartedAt) * 100) / 100
    logConversationPerf('history:merge-sort:done', {
      conversationId,
      existingCount: existing.length,
      incomingCount: history.length,
      resultCount: messages.value[conversationId].length,
      applyMs,
    })
  }

  function _findMessage(channelId: string, messageId: string): Message | undefined {
    const inChannel = messages.value[channelId]?.find(m => m.id === messageId)
    if (inChannel) return inChannel
    for (const root of Object.keys(threadMessages.value)) {
      const msg = threadMessages.value[root]?.find(m => m.id === messageId)
      if (msg) return msg
    }
    return undefined
  }

  function _setMyReaction(msg: Message, emoji: string, present: boolean) {
    const idx = msg.myReactions.findIndex(e => e === emoji)
    if (present && idx === -1) msg.myReactions.push(emoji)
    if (!present && idx !== -1) msg.myReactions.splice(idx, 1)
  }

  return {
    channels,
    directMessages,
    activeChannelId,
    activeChannel,
    activeConversation,
    activeMessages,
    isThreadPanelOpen,
    activeThreadRootId,
    activeThreadConversationId,
    activeThreadRootMessage,
    activeThreadReplies,
    workspace,
    notifications,
    activeCalls,
    pendingInvites,
    presenceByUserId,
    typingByConversationId,
    bootstrapped,
    messages,
    threadMessages,
    threadSummaries,
    userNames,
    userAvatars,
    toast,
    lastAppliedEventSeq,
    lastAckedEventSeq,
    setChannels,
    selectChannel,
    registerUserName,
    registerUserIdentity,
    resolveDisplayName,
    resolveAvatarUrl,
    addOptimisticMessage,
    reconcileMessage,
    addMessage,
    openThread,
    closeThread,
    sendThreadReply,
    startRealtimeFlow,
    startBootstrap,
    handleBootstrapResponse,
    handleSyncSinceResponse,
    handleAckResponse,
    handlePresenceEvent,
    handleTypingEvent,
    handleServerEvent,
    handleSendMessageAck,
    handleReactionAck,
    handleSubscribeThreadResponse,
    registerWsHandlers,
    queueReactionOp,
    isReactionOpPending,
    isConversationHistoryLoading,
    isConversationInitialLoading,
    conversationHasMoreHistory,
    applyBootstrapSnapshot,
    ensureConversationHistory,
    loadOlderConversationHistory,
    openDirectMessage,
    removeConversationLocal,
    onClientFocus,
    setClientActive,
  }
})

function notificationSummaryToItem(summary: NotificationSummary): NotificationItem {
  return {
    id: summary.notificationId,
    type: summary.type.toString(),
    title: summary.title,
    body: summary.body,
    conversationId: summary.conversationId,
    isRead: summary.isRead,
    createdAt: summary.createdAt
      ? new Date(Number(summary.createdAt.seconds) * 1000).toISOString()
      : new Date().toISOString(),
  }
}

function activeCallSummaryToItem(summary: ActiveCallSummary): ActiveCallItem {
  return {
    id: summary.callId,
    conversationId: summary.conversationId,
    status: summary.status.toString(),
    participantCount: summary.participantCount,
  }
}

function callInviteSummaryToItem(summary: CallInviteSummary): PendingInviteItem {
  return {
    id: summary.inviteId,
    callId: summary.callId,
    conversationId: summary.conversationId,
    inviterUserId: summary.inviterUserId,
    state: summary.state.toString(),
    createdAt: summary.createdAt
      ? new Date(Number(summary.createdAt.seconds) * 1000).toISOString()
      : new Date().toISOString(),
    expiresAt: summary.expiresAt
      ? new Date(Number(summary.expiresAt.seconds) * 1000).toISOString()
      : new Date().toISOString(),
  }
}

function workspaceRoleToSlug(role: WorkspaceRole): string {
  switch (role) {
    case WorkspaceRole.ADMIN:
      return 'admin'
    case WorkspaceRole.OWNER:
      return 'owner'
    case WorkspaceRole.MEMBER:
      return 'member'
    default:
      return ''
  }
}
