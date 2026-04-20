import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  CallStatus,
  ConversationType,
  NotificationLevel,
  NotificationType,
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
  MessageUpdatedEvent,
  MessageDeletedEvent,
  BootstrapResponse,
  SyncSinceResponse,
  AckResponse,
  ReadCursorAck,
  ConversationSummary,
  ReadCounterUpdatedEvent,
  NotificationAddedEvent,
  NotificationLevelChangedEvent,
  CallStateChangedEvent,
  CallInviteCreatedEvent,
  CallInviteCancelledEvent,
  TaskStatusChangedEvent,
  NotificationResolvedEvent,
  NotificationSummary,
  ActiveCallSummary,
  CallInviteSummary,
  PresenceEvent,
  MessageAlertEvent,
  UserCallPresenceChangedEvent,
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
import { ChatApiError, getMessageContext, listConversationMessages, listDmCandidates, listUnreadFeed, resolveUnreadFeedNotification } from '@/services/http/chatApi'
import type {
  ConversationMessageItem,
  MessageEntityItem,
  UnreadFeedItem as HttpUnreadFeedItem,
} from '@/services/http/chatApi'
import type { MessageEntity as ProtoMessageEntity } from '@/shared/proto/packets_pb'
import { getOrCreateClientInstanceId } from '@/services/storage/clientInstanceStorage'
import { generateId } from '@/services/id'
import { getPlatformOrNull } from '@/platform'
import {
  cacheConversations,
  loadCachedConversations,
  cacheMessages,
  cacheSingleMessage,
  loadCachedMessages,
  cacheThreadSummaries,
  loadCachedThreadSummaries,
} from '@/services/db/cache'

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
  notificationLevel: NotificationLevel
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
  notificationLevel: NotificationLevel
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

export type MessageEntityKind = 'user' | 'task' | 'document'

export interface MessageEntity {
  kind: MessageEntityKind
  targetId: string
  label: string
  href: string
  start: number
  end: number
}

export type SendStatus = 'sending' | 'queued' | 'failed'

export interface Message {
  id: string
  channelId: string
  senderId: string
  senderName: string
  senderAvatarUrl?: string
  body: string
  entities?: MessageEntity[]
  channelSeq: bigint
  threadSeq: bigint
  threadRootMessageId?: string
  mentionedUserIds: string[]
  mentionEveryone: boolean
  createdAt: string
  editedAt?: string
  reactions: ReactionCount[]
  myReactions: string[]
  attachments?: MessageAttachment[]
  clientMsgId?: string
  /** @deprecated Use sendStatus instead. Kept temporarily for migration. */
  pending?: boolean
  /** Delivery status: 'sending' | 'queued' | 'failed' | undefined (confirmed). */
  sendStatus?: SendStatus
  /** Human-readable reason when sendStatus is 'failed'. */
  failReason?: string
  /** Internal: true once a server event or replay confirmed this thread reply. */
  serverConfirmed?: boolean
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

export type ChatViewMode = 'conversation' | 'unread'

export interface UnreadFeedItem {
  id: string
  kind: 'message' | 'mention' | 'thread'
  notificationId?: string
  conversationId: string
  conversationKind: 'channel' | 'dm'
  conversationVisibility: 'public' | 'private' | 'dm'
  conversationTitle: string
  messageId?: string
  threadRootMessageId?: string
  senderId?: string
  senderName: string
  body: string
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

export interface IncomingMessageNotification {
  reason: 'message_alert' | 'mention' | 'notification'
  conversationId: string
  messageId?: string
  threadRootMessageId?: string
  senderId: string
  senderName: string
  body: string
  attachmentCount: number
}

export type IncomingMessageNotificationHandler = (evt: IncomingMessageNotification) => void

export interface TaskStatusChangedNotification {
  taskId: string
  publicId: string
  fromStatusId: string
  toStatusId: string
  updatedBy: string
  updatedAt: string
}

export type TaskStatusChangedNotificationHandler = (evt: TaskStatusChangedNotification) => void

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
  userCallPresence: Map<string, number>
  pendingInvites: CallInviteSummary[]
  unread: Map<string, { unreadMessages: number; unreadMentions: number; hasUnreadThreadReplies: boolean }>
  presence: Map<string, PresenceEvent>
}

function normalizeMessageEntities(raw: Array<MessageEntityItem | ProtoMessageEntity> | undefined | null): MessageEntity[] {
  return (raw ?? []).map(entity => ({
    kind: typeof entity.kind === 'string'
      ? entity.kind
      : entity.kind === 1
        ? 'user'
        : entity.kind === 2
          ? 'task'
          : 'document',
    targetId: 'target_id' in entity ? entity.target_id : entity.targetId,
    label: entity.label,
    href: entity.href,
    start: entity.start,
    end: entity.end,
  }))
}

function mentionedUserIdsFromEntities(entities: MessageEntity[]): string[] {
  return entities.filter(entity => entity.kind === 'user').map(entity => entity.targetId)
}

function mentionedUserIdsFromPayload(
  rawEntities: Array<MessageEntityItem | ProtoMessageEntity> | undefined | null,
  fallbackMentionedUserIds: readonly string[] | undefined | null,
): string[] {
  const entities = normalizeMessageEntities(rawEntities)
  if (entities.length > 0) {
    return mentionedUserIdsFromEntities(entities)
  }
  return [...(fallbackMentionedUserIds ?? [])]
}

function decodeNotificationEscapeToken(token: string): string {
  switch (token) {
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    case '"':
      return '"'
    case '\'':
      return '\''
    case '/':
      return '/'
    case '\\':
      return '\\'
    default:
      return token
  }
}

function decodeNotificationText(input: string | undefined | null): string {
  if (!input) return ''

  return input
    .replace(/\\\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\\(["\\/'])/g, (_match, token: string) => decodeNotificationEscapeToken(token))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(["\\/bfnrt'])/g, (_match, token: string) => decodeNotificationEscapeToken(token))
}

function unreadFeedItemFromHttp(item: HttpUnreadFeedItem): UnreadFeedItem {
  return {
    id: item.id,
    kind: item.kind,
    notificationId: item.notification_id || undefined,
    conversationId: item.conversation_id,
    conversationKind: item.conversation_kind,
    conversationVisibility: item.conversation_visibility,
    conversationTitle: decodeNotificationText(item.conversation_title),
    messageId: item.message_id || undefined,
    threadRootMessageId: item.thread_root_message_id || undefined,
    senderId: item.sender_id || undefined,
    senderName: decodeNotificationText(item.sender_name),
    body: decodeNotificationText(item.body),
    createdAt: item.created_at,
  }
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
  // Write to localStorage (synchronous fallback for bootstrap)
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
  // Write-through to IndexedDB (fire-and-forget)
  void cacheThreadSummaries(userId, summaries)
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useChatStore = defineStore('chat', () => {
  const channels = ref<Channel[]>([])
  const directMessages = ref<DirectMessage[]>([])
  const activeChannelId = ref<string>('')
  const chatViewMode = ref<ChatViewMode>('conversation')
  const workspace = ref<WorkspaceShell | null>(null)
  const notifications = ref<NotificationItem[]>([])
  const activeCalls = ref<ActiveCallItem[]>([])
  const userCallPresenceByUserId = ref<Record<string, number>>({})
  const pendingInvites = ref<PendingInviteItem[]>([])
  const presenceByUserId = ref<Record<string, PresenceEvent>>({})
  const typingByConversationId = ref<Record<string, TypingState[]>>({})
  const bootstrapped = ref(false)
  /** True when UI is showing data loaded from IndexedDB cache, before server bootstrap. */
  const cachedBootstrap = ref(false)

  const messages = ref<Record<string, Message[]>>({})
  const conversationHistoryState = new Map<string, ConversationHistoryState>()
  const conversationInitialLoadingById = ref<Record<string, boolean>>({})
  const threadMessages = ref<Record<string, Message[]>>({})
  const threadReplayVersionByRoot = ref<Record<string, number>>({})
  const threadSummaries = ref<Record<string, ThreadSummary>>({})
  const activeThreadRootId = ref('')
  const activeThreadConversationId = ref('')
  const focusedMessageId = ref('')
  const focusedThreadMessageId = ref('')
  const conversationComposerFocusToken = ref(0)
  const threadComposerFocusToken = ref(0)
  const unreadFeedItems = ref<UnreadFeedItem[]>([])
  const unreadFeedTotalCount = ref(0)
  const unreadFeedLoading = ref(false)
  const unreadFeedError = ref('')
  const unreadFeedLoaded = ref(false)
  const unreadFeedRefreshQueued = ref(false)
  const userNames = ref<Record<string, string>>({})
  const userEmails = ref<Record<string, string>>({})
  const userAvatars = ref<Record<string, string>>({})
  const pendingReactionOps = ref<Record<string, PendingReactionOp>>({})
  /** Tracks active send timeouts by clientMsgId. Cleared on ACK or discard. */
  const sendTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  const threadReplayResyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingThreadReadResolutions = new Map<string, Promise<void>>()
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

  function getConversationById(conversationId: string): ActiveConversation | null {
    const channel = channels.value.find(c => c.id === conversationId)
    if (channel) {
      return {
        id: channel.id,
        title: channel.name,
        kind: channel.kind,
        visibility: channel.visibility,
        unread: channel.unread,
      }
    }
    const dm = directMessages.value.find(item => item.id === conversationId)
    if (!dm) return null
    return {
      id: dm.id,
      title: dm.displayName,
      kind: 'dm',
      visibility: 'dm',
      unread: dm.unread,
    }
  }

  function getMessagesForConversation(conversationId: string): Message[] {
    return messages.value[conversationId] ?? []
  }

  function getTypingForConversation(conversationId: string): TypingState[] {
    return typingByConversationId.value[conversationId] ?? []
  }

  function getThreadRoot(conversationId: string, rootId: string): Message | null {
    if (!conversationId || !rootId) return null
    return messages.value[conversationId]?.find(item => item.id === rootId) ?? null
  }

  function getThreadReplies(rootId: string): Message[] {
    const list = [...(threadMessages.value[rootId] ?? [])]
    list.sort((a, b) => {
      if (a.threadSeq !== b.threadSeq) return Number(a.threadSeq - b.threadSeq)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
    return list
  }
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
  const activeThreadReplayVersion = computed(() => {
    if (!isThreadPanelOpen.value) return 0
    return threadReplayVersionByRoot.value[activeThreadRootId.value] ?? 0
  })

  let bootstrapStage: BootstrapStage | null = null
  let bootstrapPresenceOverlay = new Map<string, PresenceEvent>()
  let bufferedServerEvents: ServerEvent[] = []
  let seenEventIds = new Set<string>()
  let historyLoadToken = 0
  const historyLoadTokenByConversation = new Map<string, number>()
  let ackTimer: ReturnType<typeof setTimeout> | null = null
  let pendingAckEventCount = 0
  const pendingReadByConversation = new Map<string, bigint>()
  let clientIsActive = true
  let clientInstanceId = getOrCreateClientInstanceId()
  let userDirectoryHydrated = false
  let userDirectoryPromise: Promise<void> | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let unreadFeedRefreshTimer: ReturnType<typeof setTimeout> | null = null
  const incomingMessageNotificationHandlers = new Set<IncomingMessageNotificationHandler>()
  const taskStatusChangedNotificationHandlers = new Set<TaskStatusChangedNotificationHandler>()
  const DEBUG_CONVERSATION_OPEN_PERF = import.meta.env.DEV

  function persistThreadSummaries() {
    const userId = workspace.value?.selfUserId ?? ''
    if (!userId) return
    saveThreadSummariesForUser(userId, threadSummaries.value)
  }

  function bumpThreadReplayVersion(rootId: string) {
    if (!rootId) return
    threadReplayVersionByRoot.value = {
      ...threadReplayVersionByRoot.value,
      [rootId]: (threadReplayVersionByRoot.value[rootId] ?? 0) + 1,
    }
  }

  function upsertThreadSummary(rootId: string, summary: ThreadSummary) {
    threadSummaries.value[rootId] = summary
    persistThreadSummaries()
  }

  function clearThreadReplayResyncTimer(rootId: string) {
    const timer = threadReplayResyncTimers.get(rootId)
    if (!timer) return
    clearTimeout(timer)
    threadReplayResyncTimers.delete(rootId)
  }

  function clearAllThreadReplayResyncTimers() {
    for (const timer of threadReplayResyncTimers.values()) {
      clearTimeout(timer)
    }
    threadReplayResyncTimers.clear()
  }

  function highestConfirmedThreadSeq(rootId: string): bigint {
    const list = threadMessages.value[rootId] ?? []
    return list.reduce((max, message) => {
      if (!message.serverConfirmed || message.sendStatus || message.pending) return max
      return message.threadSeq > max ? message.threadSeq : max
    }, 0n)
  }

  function confirmedThreadReplyCount(rootId: string): number {
    const list = threadMessages.value[rootId] ?? []
    return list.reduce((count, message) => {
      if (!message.serverConfirmed || message.sendStatus || message.pending) return count
      return count + 1
    }, 0)
  }

  function isThreadReplayCacheIncomplete(rootId: string): boolean {
    const summary = threadSummaries.value[rootId]
    if (!summary) return false
    return confirmedThreadReplyCount(rootId) < summary.replyCount
  }

  function threadReplayCursor(rootId: string): bigint {
    if (isThreadReplayCacheIncomplete(rootId)) return 0n
    return highestConfirmedThreadSeq(rootId)
  }

  function requestThreadReplayRecovery(rootId: string, conversationId: string) {
    if (!rootId || !conversationId) return
    clearThreadReplayResyncTimer(rootId)
    threadReplayResyncTimers.set(rootId, setTimeout(() => {
      threadReplayResyncTimers.delete(rootId)
      if (!isThreadPanelOpen.value) return
      if (activeThreadRootId.value !== rootId || activeThreadConversationId.value !== conversationId) return
      const ws = useWsStore()
      if (ws.state !== 'LIVE_SYNCED') return
      ws.sendSubscribeThread(conversationId, rootId, threadReplayCursor(rootId))
    }, 150))
  }

  function maybeRecoverActiveThread(rootId: string, conversationId: string, force = false) {
    if (!isThreadPanelOpen.value) return
    if (activeThreadRootId.value !== rootId || activeThreadConversationId.value !== conversationId) return
    if (force) {
      requestThreadReplayRecovery(rootId, conversationId)
      return
    }
    const summary = threadSummaries.value[rootId]
    if (!summary) return
    const highestConfirmedSeq = highestConfirmedThreadSeq(rootId)
    if (summary.lastThreadSeq <= highestConfirmedSeq && !isThreadReplayCacheIncomplete(rootId)) return
    requestThreadReplayRecovery(rootId, conversationId)
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

  function showConversationView() {
    chatViewMode.value = 'conversation'
  }

  function showUnreadView() {
    chatViewMode.value = 'unread'
  }

  function focusConversationMessage(messageId: string) {
    focusedMessageId.value = messageId
  }

  function focusThreadMessage(messageId: string) {
    focusedThreadMessageId.value = messageId
  }

  function requestConversationComposerFocus() {
    conversationComposerFocusToken.value += 1
  }

  function requestThreadComposerFocus() {
    threadComposerFocusToken.value += 1
  }

  function clearFocusedMessages() {
    focusedMessageId.value = ''
    focusedThreadMessageId.value = ''
  }

  function removeUnreadFeedItemLocally(itemId: string, notificationId?: string) {
    const previousLength = unreadFeedItems.value.length
    unreadFeedItems.value = unreadFeedItems.value.filter(item =>
      item.id !== itemId && (!notificationId || item.notificationId !== notificationId),
    )
    if (unreadFeedItems.value.length < previousLength) {
      unreadFeedTotalCount.value = Math.max(0, unreadFeedTotalCount.value - (previousLength - unreadFeedItems.value.length))
    }
    if (notificationId) {
      notifications.value = notifications.value.filter(item => item.id !== notificationId)
    }
  }

  function removeUnreadFeedItemsForThread(conversationId: string, threadRootMessageId: string): UnreadFeedItem[] {
    if (!conversationId || !threadRootMessageId) return []
    const removed = unreadFeedItems.value.filter(item =>
      item.conversationId === conversationId
      && (item.threadRootMessageId === threadRootMessageId || item.messageId === threadRootMessageId),
    )
    if (removed.length === 0) return []

    const removedIds = new Set(removed.map(item => item.id))
    const removedNotificationIds = new Set(
      removed.flatMap(item => item.notificationId ? [item.notificationId] : []),
    )

    unreadFeedItems.value = unreadFeedItems.value.filter(item => !removedIds.has(item.id))
    unreadFeedTotalCount.value = Math.max(0, unreadFeedTotalCount.value - removed.length)

    if (removedNotificationIds.size > 0) {
      notifications.value = notifications.value.filter(item => !removedNotificationIds.has(item.id))
    }

    return removed
  }

  async function markThreadUnreadAsRead(
    conversationId: string,
    threadRootMessageId: string,
    lastReadSeq = 0n,
  ): Promise<void> {
    if (!conversationId || !threadRootMessageId) return
    const key = `${conversationId}:${threadRootMessageId}`
    const existing = pendingThreadReadResolutions.get(key)
    if (existing) return existing

    const pending = (async () => {
      const removedItems = removeUnreadFeedItemsForThread(conversationId, threadRootMessageId)
      const notificationIds = Array.from(new Set(
        removedItems.flatMap(item => item.notificationId ? [item.notificationId] : []),
      ))
      if (notificationIds.length > 0) {
        await Promise.allSettled(notificationIds.map(notificationId => resolveUnreadFeedNotification(notificationId)))
      }
      if (lastReadSeq > 0n) {
        requestReadMark(conversationId, lastReadSeq)
      }
    })().finally(() => {
      pendingThreadReadResolutions.delete(key)
    })

    pendingThreadReadResolutions.set(key, pending)
    return pending
  }

  function selectChannel(id: string) {
    const selectStartedAt = performance.now()
    logConversationPerf('select', {
      conversationId: id,
      cachedMessages: messages.value[id]?.length ?? 0,
      at: new Date().toISOString(),
    })
    activeChannelId.value = id
    showConversationView()
    clearFocusedMessages()
    requestConversationComposerFocus()
    saveActiveConversationSelection(id)
    if (activeThreadConversationId.value !== id) {
      closeThread()
    }
    const historyPromise = ensureConversationHistory(id, selectStartedAt)
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
    return historyPromise
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
    if (normalizedEmail) {
      userEmails.value[userId] = normalizedEmail
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
    const idx = list.findIndex(m => m.clientMsgId === clientMsgId && (m.sendStatus || m.pending))
    if (idx === -1) return
    clearSendTimeout(clientMsgId)
    const existing = list[idx]
    const confirmed: Message = {
      ...existing,
      id: ack.messageId,
      channelSeq: ack.channelSeq,
      createdAt: ack.createdAt ? new Date(Number(ack.createdAt.seconds) * 1000).toISOString() : existing.createdAt,
      pending: undefined,
      sendStatus: undefined,
      failReason: undefined,
    }
    list.splice(idx, 1, confirmed)
    // Write-through confirmed message to IndexedDB (fire-and-forget)
    void cacheSingleMessage(confirmed)
  }

  function reconcileThreadMessage(_channelId: string, clientMsgId: string, ack: SendMessageAck) {
    // SendMessageAck does not include thread_seq; we reconcile identity/timestamps here
    // and rely on the subsequent message_created event as the authoritative thread order.
    for (const rootId of Object.keys(threadMessages.value)) {
      const list = threadMessages.value[rootId]
      const idx = list.findIndex(m => m.clientMsgId === clientMsgId && (m.sendStatus || m.pending))
      if (idx === -1) continue
      clearSendTimeout(clientMsgId)
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
        pending: undefined,
        sendStatus: undefined,
        failReason: undefined,
      } satisfies Message)
      return
    }
  }

  // ── Send status helpers ────────────────────────────────────────────────────

  const SEND_TIMEOUT_MS = 15_000

  function clearSendTimeout(clientMsgId: string) {
    const timer = sendTimeouts.get(clientMsgId)
    if (timer) {
      clearTimeout(timer)
      sendTimeouts.delete(clientMsgId)
    }
  }

  /** Clear all in-flight send timeouts. Called on logout / store reset. */
  function clearAllSendTimeouts() {
    for (const timer of sendTimeouts.values()) {
      clearTimeout(timer)
    }
    sendTimeouts.clear()
  }

  function resetRuntimeState() {
    clearPendingNotificationLevelChange()
    clearAllSendTimeouts()
    clearAllThreadReplayResyncTimers()

    if (ackTimer) {
      clearTimeout(ackTimer)
      ackTimer = null
    }
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    if (unreadFeedRefreshTimer) {
      clearTimeout(unreadFeedRefreshTimer)
      unreadFeedRefreshTimer = null
    }
    pendingThreadReadResolutions.clear()

    channels.value = []
    directMessages.value = []
    activeChannelId.value = ''
    chatViewMode.value = 'conversation'
    workspace.value = null
    notifications.value = []
    activeCalls.value = []
    pendingInvites.value = []
    presenceByUserId.value = {}
    typingByConversationId.value = {}
    bootstrapped.value = false
    cachedBootstrap.value = false

    messages.value = {}
    threadMessages.value = {}
    threadReplayVersionByRoot.value = {}
    threadSummaries.value = {}
    conversationInitialLoadingById.value = {}
    activeThreadRootId.value = ''
    activeThreadConversationId.value = ''
    focusedMessageId.value = ''
    focusedThreadMessageId.value = ''
    unreadFeedItems.value = []
    unreadFeedTotalCount.value = 0
    unreadFeedLoading.value = false
    unreadFeedError.value = ''
    unreadFeedLoaded.value = false
    unreadFeedRefreshQueued.value = false

    userNames.value = {}
    userEmails.value = {}
    userAvatars.value = {}
    pendingReactionOps.value = {}
    toast.value = null
    lastAppliedEventSeq.value = 0n
    lastAckedEventSeq.value = 0n

    conversationHistoryState.clear()
    historyLoadTokenByConversation.clear()
    pendingReadByConversation.clear()
    incomingMessageNotificationHandlers.clear()
    taskStatusChangedNotificationHandlers.clear()

    bootstrapStage = null
    bootstrapPresenceOverlay = new Map()
    bufferedServerEvents = []
    seenEventIds = new Set()
    historyLoadToken = 0
    pendingAckEventCount = 0
    clientIsActive = true
    userDirectoryHydrated = false
    userDirectoryPromise = null

    clientInstanceId = ''
  }

  /**
   * Start a 15-second timeout for a message in 'sending' state.
   * If the ACK doesn't arrive, transition to 'failed'.
   */
  function startSendTimeout(channelId: string, clientMsgId: string, isThread: boolean, threadRootId?: string) {
    clearSendTimeout(clientMsgId) // avoid double timers
    const timer = setTimeout(() => {
      sendTimeouts.delete(clientMsgId)
      if (isThread && threadRootId) {
        const list = threadMessages.value[threadRootId]
        if (!list) return
        const msg = list.find(m => m.clientMsgId === clientMsgId && m.sendStatus === 'sending')
        if (msg) {
          msg.sendStatus = 'failed'
          msg.failReason = 'Message timed out'
        }
      } else {
        const list = messages.value[channelId]
        if (!list) return
        const msg = list.find(m => m.clientMsgId === clientMsgId && m.sendStatus === 'sending')
        if (msg) {
          msg.sendStatus = 'failed'
          msg.failReason = 'Message timed out'
        }
      }
    }, SEND_TIMEOUT_MS)
    sendTimeouts.set(clientMsgId, timer)
  }

  function updateSendStatus(channelId: string, clientMsgId: string, status: SendStatus | undefined, failReason?: string) {
    const list = messages.value[channelId]
    if (!list) return
    const msg = list.find(m => m.clientMsgId === clientMsgId)
    if (!msg) return
    msg.sendStatus = status
    msg.failReason = failReason
    if (status !== 'sending') {
      clearSendTimeout(clientMsgId)
    }
  }

  function updateThreadSendStatus(rootMessageId: string, clientMsgId: string, status: SendStatus | undefined, failReason?: string) {
    const list = threadMessages.value[rootMessageId]
    if (!list) return
    const msg = list.find(m => m.clientMsgId === clientMsgId)
    if (!msg) return
    msg.sendStatus = status
    msg.failReason = failReason
    if (status !== 'sending') {
      clearSendTimeout(clientMsgId)
    }
  }

  function retryMessage(channelId: string, clientMsgId: string) {
    const list = messages.value[channelId]
    if (!list) return
    const msg = list.find(m => m.clientMsgId === clientMsgId && m.sendStatus === 'failed')
    if (!msg) return
    const ws = useWsStore()
    if (ws.state === 'DISCONNECTED' || ws.state === 'CONNECTING') {
      // Offline — queue for delivery after reconnect
      msg.sendStatus = 'queued'
      msg.failReason = undefined
      import('@/composables/useOfflineQueue').then(({ useOfflineQueue }) => {
        useOfflineQueue().enqueue({
          conversationId: channelId,
          body: msg.body,
          clientMsgId,
          attachmentIds: msg.attachments?.map(a => a.id),
          entities: msg.entities,
        })
      })
      return
    }
    msg.sendStatus = 'sending'
    msg.failReason = undefined
    const attachmentIds = msg.attachments?.map(a => a.id) ?? []
    const entities = msg.entities ?? []
    const sent = entities.length > 0
      ? ws.sendMessage(channelId, msg.body, clientMsgId, undefined, attachmentIds, entities)
      : ws.sendMessage(channelId, msg.body, clientMsgId, undefined, attachmentIds)
    if (!sent) {
      msg.sendStatus = 'failed'
      msg.failReason = 'Connection lost'
      return
    }
    startSendTimeout(channelId, clientMsgId, false)
  }

  function retryThreadMessage(rootMessageId: string, clientMsgId: string) {
    const list = threadMessages.value[rootMessageId]
    if (!list) return
    const msg = list.find(m => m.clientMsgId === clientMsgId && m.sendStatus === 'failed')
    if (!msg) return
    const ws = useWsStore()
    if (ws.state === 'DISCONNECTED' || ws.state === 'CONNECTING') {
      // Offline — queue for delivery after reconnect
      msg.sendStatus = 'queued'
      msg.failReason = undefined
      import('@/composables/useOfflineQueue').then(({ useOfflineQueue }) => {
        useOfflineQueue().enqueue({
          conversationId: msg.channelId,
          body: msg.body,
          clientMsgId,
          threadRootMessageId: rootMessageId,
          attachmentIds: msg.attachments?.map(a => a.id),
          entities: msg.entities,
        })
      })
      return
    }
    msg.sendStatus = 'sending'
    msg.failReason = undefined
    const attachmentIds = msg.attachments?.map(a => a.id) ?? []
    const entities = msg.entities ?? []
    const sent = entities.length > 0
      ? ws.sendMessage(msg.channelId, msg.body, clientMsgId, rootMessageId, attachmentIds, entities)
      : ws.sendMessage(msg.channelId, msg.body, clientMsgId, rootMessageId, attachmentIds)
    if (!sent) {
      msg.sendStatus = 'failed'
      msg.failReason = 'Connection lost'
      return
    }
    startSendTimeout(msg.channelId, clientMsgId, true, rootMessageId)
  }

  function discardFailedMessage(channelId: string, clientMsgId: string) {
    const list = messages.value[channelId]
    if (!list) return
    const idx = list.findIndex(m => m.clientMsgId === clientMsgId && m.sendStatus === 'failed')
    if (idx !== -1) {
      clearSendTimeout(clientMsgId)
      list.splice(idx, 1)
    }
  }

  function discardFailedThreadMessage(rootMessageId: string, clientMsgId: string) {
    const list = threadMessages.value[rootMessageId]
    if (!list) return
    const idx = list.findIndex(m => m.clientMsgId === clientMsgId && m.sendStatus === 'failed')
    if (idx !== -1) {
      clearSendTimeout(clientMsgId)
      list.splice(idx, 1)
    }
  }

  // ── Thread management ───────────────────────────────────────────────────────

  function openThread(rootMessage: Message) {
    if (rootMessage.threadRootMessageId) return
    if (activeThreadRootId.value && activeThreadRootId.value !== rootMessage.id) {
      clearThreadReplayResyncTimer(activeThreadRootId.value)
    }
    focusedThreadMessageId.value = ''
    activeThreadConversationId.value = rootMessage.channelId
    activeThreadRootId.value = rootMessage.id
    if (!threadMessages.value[rootMessage.id]) threadMessages.value[rootMessage.id] = []
    requestThreadComposerFocus()
    void markThreadUnreadAsRead(rootMessage.channelId, rootMessage.id, rootMessage.channelSeq)
    // Only server-confirmed replies advance the replay cursor. ACK-only
    // optimistic replies stay visible but must not suppress a later backfill.
    // If the confirmed cache is smaller than the known reply total, reopen
    // from zero so older replies are replayed instead of showing a partial thread.
    const lastKnownSeq = threadReplayCursor(rootMessage.id)
    useWsStore().sendSubscribeThread(rootMessage.channelId, rootMessage.id, lastKnownSeq)
  }

  function ensureThreadSubscribed(conversationId: string, rootMessageId: string) {
    if (!conversationId || !rootMessageId) return
    if (!threadMessages.value[rootMessageId]) threadMessages.value[rootMessageId] = []
    const rootMessage = getThreadRoot(conversationId, rootMessageId)
    if (rootMessage) {
      void markThreadUnreadAsRead(conversationId, rootMessageId, rootMessage.channelSeq)
    }
    const ws = useWsStore()
    ws.sendSubscribeThread(conversationId, rootMessageId, threadReplayCursor(rootMessageId))
  }

  function closeThread() {
    clearThreadReplayResyncTimer(activeThreadRootId.value)
    activeThreadRootId.value = ''
    activeThreadConversationId.value = ''
    focusedThreadMessageId.value = ''
  }

  function sendThreadReply(body: string, attachmentIds: string[] = [], attachments: MessageAttachment[] = [], entities: MessageEntity[] = []) {
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

    const isOffline = ws.state === 'DISCONNECTED' || ws.state === 'CONNECTING'

    _upsertThreadMessage(rootId, {
      id: clientMsgId,
      channelId,
      senderId,
      senderName,
      body: text,
      entities,
      channelSeq: 0n,
      threadSeq: nextThreadSeq,
      threadRootMessageId: rootId,
      mentionedUserIds: mentionedUserIdsFromEntities(entities),
      mentionEveryone: false,
      createdAt: now,
      reactions: [],
      myReactions: [],
      attachments,
      clientMsgId,
      sendStatus: isOffline ? 'queued' : 'sending',
      serverConfirmed: false,
    })

    const known = threadSummaries.value[rootId]
    upsertThreadSummary(rootId, {
      replyCount: Math.max(known?.replyCount ?? 0, Number(nextThreadSeq)),
      lastThreadSeq: nextThreadSeq,
      lastReplyAt: now,
      lastReplyUserId: senderId,
    })

    if (isOffline) {
      // Lazy-import to avoid circular deps — queue for delivery after reconnect
      import('@/composables/useOfflineQueue').then(({ useOfflineQueue }) => {
        useOfflineQueue().enqueue({ conversationId: channelId, body: text, clientMsgId, threadRootMessageId: rootId, entities })
      })
    } else {
      const sent = entities.length > 0
        ? ws.sendMessage(channelId, text, clientMsgId, rootId, attachmentIds, entities)
        : ws.sendMessage(channelId, text, clientMsgId, rootId, attachmentIds)
      if (!sent) {
        updateThreadSendStatus(rootId, clientMsgId, 'failed', 'Connection lost')
      } else {
        startSendTimeout(channelId, clientMsgId, true, rootId)
      }
    }
  }

  function sendMessageToConversation(
    conversationId: string,
    body: string,
    attachmentIds: string[] = [],
    attachments: MessageAttachment[] = [],
    entities: MessageEntity[] = [],
  ) {
    const text = body.trim()
    if (!conversationId || (!text && attachmentIds.length === 0)) return

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
    const senderAvatarUrl = (
      (authStore.user?.avatarUrl?.trim() || '')
      || (workspace.value?.selfAvatarUrl?.trim() || '')
      || (resolveAvatarUrl(senderId).trim() || '')
    )

    const clientMsgId = generateId()
    const now = new Date().toISOString()
    const isOffline = ws.state === 'DISCONNECTED' || ws.state === 'CONNECTING'

    addOptimisticMessage({
      id: clientMsgId,
      channelId: conversationId,
      senderId,
      senderName,
      senderAvatarUrl,
      body: text,
      entities,
      channelSeq: 0n,
      threadSeq: 0n,
      mentionedUserIds: mentionedUserIdsFromEntities(entities),
      mentionEveryone: false,
      createdAt: now,
      reactions: [],
      myReactions: [],
      attachments,
      clientMsgId,
      sendStatus: isOffline ? 'queued' : 'sending',
      serverConfirmed: false,
    })

    if (isOffline) {
      import('@/composables/useOfflineQueue').then(({ useOfflineQueue }) => {
        useOfflineQueue().enqueue({ conversationId, body: text, clientMsgId, attachmentIds, entities })
      })
      return
    }

    const sent = entities.length > 0
      ? ws.sendMessage(conversationId, text, clientMsgId, undefined, attachmentIds, entities)
      : ws.sendMessage(conversationId, text, clientMsgId, undefined, attachmentIds)
    if (!sent) {
      updateSendStatus(conversationId, clientMsgId, 'failed', 'Connection lost')
      return
    }
    startSendTimeout(conversationId, clientMsgId, false)
  }

  function sendThreadReplyToRoot(
    conversationId: string,
    rootMessageId: string,
    body: string,
    attachmentIds: string[] = [],
    attachments: MessageAttachment[] = [],
    entities: MessageEntity[] = [],
  ) {
    const text = body.trim()
    if (!conversationId || !rootMessageId || (!text && attachmentIds.length === 0)) return
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
    const nextThreadSeq = (threadSummaries.value[rootMessageId]?.lastThreadSeq ?? 0n) + 1n
    const isOffline = ws.state === 'DISCONNECTED' || ws.state === 'CONNECTING'

    _upsertThreadMessage(rootMessageId, {
      id: clientMsgId,
      channelId: conversationId,
      senderId,
      senderName,
      body: text,
      entities,
      channelSeq: 0n,
      threadSeq: nextThreadSeq,
      threadRootMessageId: rootMessageId,
      mentionedUserIds: mentionedUserIdsFromEntities(entities),
      mentionEveryone: false,
      createdAt: now,
      reactions: [],
      myReactions: [],
      attachments,
      clientMsgId,
      sendStatus: isOffline ? 'queued' : 'sending',
      serverConfirmed: false,
    })

    const known = threadSummaries.value[rootMessageId]
    upsertThreadSummary(rootMessageId, {
      replyCount: Math.max(known?.replyCount ?? 0, Number(nextThreadSeq)),
      lastThreadSeq: nextThreadSeq,
      lastReplyAt: now,
      lastReplyUserId: senderId,
    })

    if (isOffline) {
      import('@/composables/useOfflineQueue').then(({ useOfflineQueue }) => {
        useOfflineQueue().enqueue({ conversationId, body: text, clientMsgId, threadRootMessageId: rootMessageId, attachmentIds, entities })
      })
      return
    }

    const sent = entities.length > 0
      ? ws.sendMessage(conversationId, text, clientMsgId, rootMessageId, attachmentIds, entities)
      : ws.sendMessage(conversationId, text, clientMsgId, rootMessageId, attachmentIds)
    if (!sent) {
      updateThreadSendStatus(rootMessageId, clientMsgId, 'failed', 'Connection lost')
      return
    }
    startSendTimeout(conversationId, clientMsgId, true, rootMessageId)
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
    }

    // Reconnect resumes from cached/local state. Bootstrap is the authoritative
    // refresh for unread counters, presence, notifications, and other direct-only
    // state that cannot be reconstructed from SyncSince replay alone.
    startBootstrap()
  }

  function startBootstrap() {
    const ws = useWsStore()
    bootstrapStage = null
    bootstrapPresenceOverlay = new Map()
    bufferedServerEvents = []
    if (!clientInstanceId) {
      clientInstanceId = getOrCreateClientInstanceId()
    }
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
        userCallPresence: new Map(),
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
      bootstrapStage.userCallPresence = new Map(resp.userCallPresence.map(item => [item.userId, item.activeCallCount]))
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

  /** Max conversations whose messages are pre-loaded from cache on startup. */
  const CACHED_MSG_PRELOAD_LIMIT = 5

  /**
   * Load cached conversations and messages from IndexedDB for instant startup.
   * Returns true if cached data was available and hydrated into the store.
   */
  async function loadCachedState(): Promise<boolean> {
    try {
      const cached = await loadCachedConversations()
      if (!cached || (cached.channels.length === 0 && cached.dms.length === 0)) {
        return false
      }
      channels.value = cached.channels
      directMessages.value = cached.dms
      cachedBootstrap.value = true

      // Determine which conversations' messages to preload.
      // Start with the last-opened conversation, then fill with the most
      // recently active channels/DMs (by lastActivityAt or list order).
      const authStore = useAuthStore()
      const workspaceId = workspace.value?.id || workspace.value?.name || ''
      const userId = workspace.value?.selfUserId || authStore.user?.id || ''
      const lastConversation = loadLastOpenedConversation(workspaceId, userId)

      const preloadIds: string[] = []
      if (lastConversation) {
        const exists = cached.channels.some(ch => ch.id === lastConversation)
          || cached.dms.some(dm => dm.id === lastConversation)
        if (exists) {
          activeChannelId.value = lastConversation
          requestConversationComposerFocus()
          preloadIds.push(lastConversation)
        }
      }

      // Add top recently-active conversations (channels sorted by lastActivityAt desc)
      const sortedChannels = [...cached.channels]
        .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
      for (const ch of sortedChannels) {
        if (preloadIds.length >= CACHED_MSG_PRELOAD_LIMIT) break
        if (!preloadIds.includes(ch.id)) preloadIds.push(ch.id)
      }
      // Add DMs (they are already ordered by recent activity from bootstrap)
      for (const dm of cached.dms) {
        if (preloadIds.length >= CACHED_MSG_PRELOAD_LIMIT) break
        if (!preloadIds.includes(dm.id)) preloadIds.push(dm.id)
      }

      // Load messages + thread summaries concurrently
      const [msgResults, cachedThreads] = await Promise.all([
        Promise.all(
          preloadIds.map(id => loadCachedMessages(id).then(msgs => ({ id, msgs }))),
        ),
        loadCachedThreadSummaries(userId),
      ])
      for (const { id, msgs } of msgResults) {
        if (msgs.length > 0) {
          messages.value[id] = msgs
        }
      }
      if (cachedThreads) {
        threadSummaries.value = cachedThreads
      }

      // Hydrate offline queue: inject persisted queued messages into the
      // message lists so they render immediately with 'queued' status.
      try {
        const { useOfflineQueue } = await import('@/composables/useOfflineQueue')
        const queued = await useOfflineQueue().loadPersisted()
        for (const q of queued) {
          const list = messages.value[q.conversationId]
          if (!list) continue
          // Skip if already present (e.g. from a prior render cycle)
          if (list.some(m => m.clientMsgId === q.clientMsgId)) continue
          list.push({
            id: q.clientMsgId,
            channelId: q.conversationId,
            senderId: userId,
            senderName: workspace.value?.selfDisplayName ?? '',
            body: q.body,
            entities: q.entities ?? [],
            channelSeq: 0n,
            threadSeq: 0n,
            threadRootMessageId: q.threadRootMessageId,
            mentionedUserIds: mentionedUserIdsFromEntities(q.entities ?? []),
            mentionEveryone: false,
            createdAt: new Date().toISOString(),
            reactions: [],
            myReactions: [],
            clientMsgId: q.clientMsgId,
            sendStatus: 'queued',
          })
        }
      } catch {
        // Non-fatal — queued messages will be flushed on reconnect regardless
      }

      return true
    } catch {
      return false
    }
  }

  function setCachedBootstrap(value: boolean) {
    cachedBootstrap.value = value
  }

  function applyBootstrapSnapshot(stage: BootstrapStage) {
    // Bootstrap is the authoritative snapshot — clear any pending optimistic state.
    clearPendingNotificationLevelChange()
    clearAllSendTimeouts()

    const unreadByConversation = stage.unread
    const nextChannels: Channel[] = []
    const nextDms: DirectMessage[] = []

    const mergedPresence = new Map<string, PresenceEvent>()
    for (const [userId, evt] of stage.presence.entries()) {
      mergedPresence.set(userId, evt)
    }
    for (const [userId, evt] of bootstrapPresenceOverlay.entries()) {
      mergedPresence.set(userId, newerPresenceEvent(mergedPresence.get(userId), evt))
    }
    presenceByUserId.value = {}
    for (const [userId, evt] of mergedPresence.entries()) {
      presenceByUserId.value[userId] = evt
    }

    for (const summary of stage.conversations) {
      const unread = unreadByConversation.get(summary.conversationId)?.unreadMessages ?? 0
      const hasUnreadThreadReplies = unreadByConversation.get(summary.conversationId)?.hasUnreadThreadReplies ?? false
      if (summary.conversationType === ConversationType.DM) {
        const dmUserId = summary.topic || summary.conversationId
        registerUserName(dmUserId, summary.title)
        nextDms.push({
          id: summary.conversationId,
          userId: dmUserId,
          displayName: summary.title,
          avatarUrl: resolveAvatarUrl(dmUserId),
          presence: resolveConversationPresence(summary.presence, dmUserId),
          unread,
          hasUnreadThreadReplies,
          lastMessageSeq: summary.lastMessageSeq,
          notificationLevel: summary.notificationLevel,
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
          notificationLevel: summary.notificationLevel,
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
    bootstrapPresenceOverlay = new Map()
    cachedBootstrap.value = false
    // Write-through to IndexedDB (fire-and-forget)
    void cacheConversations(nextChannels, nextDms)
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
    userCallPresenceByUserId.value = Object.fromEntries(stage.userCallPresence.entries())
    pendingInvites.value = stage.pendingInvites.map(callInviteSummaryToItem)
    // Preserve cached messages for the active conversation so the user
    // doesn't see a flash of empty content while ensureConversationHistory
    // fetches the authoritative page from the server. The HTTP history
    // response will overwrite these via applyConversationHistory.
    const preservedConversationId = activeChannelId.value
    const preservedMessages = preservedConversationId
      ? messages.value[preservedConversationId]
      : undefined
    messages.value = {}
    if (preservedConversationId && preservedMessages?.length) {
      messages.value[preservedConversationId] = preservedMessages
    }
    conversationHistoryState.clear()
    conversationInitialLoadingById.value = {}
    historyLoadTokenByConversation.clear()
    threadMessages.value = {}
    threadReplayVersionByRoot.value = {}
    threadSummaries.value = loadThreadSummariesForUser(stage.workspace?.selfUserId ?? '')
    activeThreadRootId.value = ''
    activeThreadConversationId.value = ''
    bootstrapped.value = true
    seenEventIds = new Set()

    const restoredConversation = resolveSnapshotActiveConversation(nextChannels, nextDms, stage.workspace)
    activeChannelId.value = restoredConversation
    if (restoredConversation) {
      requestConversationComposerFocus()
      saveActiveConversationSelection(restoredConversation)
    } else {
      clearActiveConversationSelection()
    }
    unreadFeedLoaded.value = false
    unreadFeedError.value = ''
    void refreshUnreadFeed()
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

  async function loadMessageContext(
    conversationId: string,
    messageId: string,
  ): Promise<'loaded' | 'not_found' | 'forbidden' | 'error'> {
    if (!conversationId || !messageId) return 'error'
    try {
      const page = await getMessageContext(conversationId, messageId)
      applyConversationHistory(conversationId, page.messages)
      return 'loaded'
    } catch (err) {
      if (err instanceof ChatApiError) {
        if (err.status === 403) return 'forbidden'
        if (err.status === 404) return 'not_found'
      }
      return 'error'
    }
  }

  async function refreshUnreadFeed(): Promise<void> {
    if (!bootstrapped.value) return
    unreadFeedLoading.value = true
    unreadFeedError.value = ''
    try {
      const response = await listUnreadFeed()
      unreadFeedItems.value = (response.items ?? []).map(unreadFeedItemFromHttp)
      unreadFeedTotalCount.value = Math.max(0, Math.floor(response.total_count ?? 0))
      unreadFeedLoaded.value = true
    } catch (err) {
      unreadFeedError.value = err instanceof Error ? err.message : 'Failed to load unread feed'
      unreadFeedLoaded.value = true
    } finally {
      unreadFeedLoading.value = false
      unreadFeedRefreshQueued.value = false
      if (unreadFeedRefreshTimer) {
        clearTimeout(unreadFeedRefreshTimer)
        unreadFeedRefreshTimer = null
      }
    }
  }

  function scheduleUnreadFeedRefresh() {
    if (!bootstrapped.value) return
    unreadFeedRefreshQueued.value = true
    if (!unreadFeedLoaded.value && chatViewMode.value !== 'unread') return
    if (unreadFeedRefreshTimer) return
    unreadFeedRefreshTimer = setTimeout(() => {
      unreadFeedRefreshTimer = null
      void refreshUnreadFeed()
    }, 1000)
  }

  function handleSyncSinceResponse(resp: SyncSinceResponse) {
    const ws = useWsStore()
    const previousCursor = lastAppliedEventSeq.value
    if (resp.needFullBootstrap) {
      ws.setStaleRebootstrap()
      startBootstrap()
      return
    }

    if (resp.events.length === 0) {
      advanceSyncCursor(resp.syncCursor)
      scheduleAckFlush()
      ws.setLiveSynced()
      drainBufferedEvents()
      _reloadActiveChannelHistory()
      return
    }

    for (const event of resp.events) {
      applySequencedEvent(event)
    }
    advanceSyncCursor(resp.syncCursor)
    scheduleAckFlush()

    if (resp.events.length >= DEFAULT_SYNC_BATCH || resp.syncCursor > previousCursor) {
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
    scheduleUnreadFeedRefresh()
  }

  function handlePresenceEvent(evt: PresenceEvent) {
    const nextPresence = newerPresenceEvent(presenceByUserId.value[evt.userId], evt)
    presenceByUserId.value[evt.userId] = nextPresence
    const ws = useWsStore()
    if (ws.state === 'BOOTSTRAPPING' || ws.state === 'RECOVERING_GAP' || ws.state === 'STALE_REBOOTSTRAP' || !bootstrapped.value) {
      bootstrapPresenceOverlay.set(evt.userId, newerPresenceEvent(bootstrapPresenceOverlay.get(evt.userId), evt))
    }
    const targetDm = directMessages.value.find(dm => dm.userId === evt.userId)
    if (targetDm) {
      targetDm.presence = nextPresence.effectivePresence === PresenceStatus.ONLINE
        ? 'online'
        : nextPresence.effectivePresence === PresenceStatus.AWAY
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
    clearThreadReplayResyncTimer(root)
    if (!threadMessages.value[root]) threadMessages.value[root] = []
    for (const evt of resp.replay) {
      _upsertThreadMessage(root, {
        ..._messageEventToMessage(evt, evt.conversationId),
        serverConfirmed: true,
      })
    }
    const currentThreadSeq = resp.currentThreadSeq
    upsertThreadSummary(root, {
      replyCount: Math.max(0, Math.floor(Number(resp.replyCount))),
      lastThreadSeq: currentThreadSeq,
      lastReplyAt: threadSummaries.value[root]?.lastReplyAt,
      lastReplyUserId: threadSummaries.value[root]?.lastReplyUserId,
    })
    bumpThreadReplayVersion(root)
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
    ws.onSetNotificationLevelResponse(handleSetNotificationLevelResponse)
  }

  function addMessage(msg: Message) {
    if (!messages.value[msg.channelId]) messages.value[msg.channelId] = []
    messages.value[msg.channelId].push(msg)
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
    const queued = bufferedServerEvents.slice()
    bufferedServerEvents = []
    for (const evt of queued) {
      applySequencedEvent(evt)
    }
  }

  function applySequencedEvent(evt: ServerEvent) {
    if (evt.eventSeq <= lastAppliedEventSeq.value) return
    applyContiguousEvent(evt)
  }

  function applyContiguousEvent(evt: ServerEvent): boolean {
    if (evt.eventSeq <= lastAppliedEventSeq.value) return true
    if (evt.eventId && seenEventIds.has(evt.eventId)) {
      advanceSyncCursor(evt.eventSeq)
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
    advanceSyncCursor(evt.eventSeq)
    pendingAckEventCount += 1
    scheduleAckFlush()
    return true
  }

  function advanceSyncCursor(nextSeq: bigint) {
    if (nextSeq <= lastAppliedEventSeq.value) return
    lastAppliedEventSeq.value = nextSeq
    saveLastAppliedEventSeq(lastAppliedEventSeq.value)
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
      case 'messageUpdated':
        _onMessageUpdated(evt.payload.value)
        break
      case 'messageDeleted':
        _onMessageDeleted(evt.payload.value)
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
        scheduleUnreadFeedRefresh()
        break
      case 'callStateChanged':
        applyCallStateChanged(evt.payload.value)
        break
      case 'userCallPresenceChanged':
        applyUserCallPresenceChanged(evt.payload.value)
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
      case 'notificationLevelChanged':
        applyNotificationLevelChanged(evt.payload.value)
        break
      case 'taskStatusChanged':
        emitTaskStatusChangedNotification(evt.payload.value)
        break
      case 'messageAlert':
        applyMessageAlert(evt.payload.value)
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
      || evt.payload.case === 'notificationLevelChanged'
      || evt.payload.case === 'taskStatusChanged'
      || evt.payload.case === 'messageAlert'
  }

  function applyConversationSummary(summary?: ConversationSummary) {
    if (!summary) return
    const unread = currentUnread(summary.conversationId)
    const hasUnreadThreadReplies = currentHasUnreadThreadReplies(summary.conversationId)
    // ConversationUpserted events from direct delivery may not carry notification_level.
    // Preserve the current level if the summary doesn't provide one (defaults to ALL=0).
    const currentLevel = currentNotificationLevel(summary.conversationId)
    const notificationLevel = summary.notificationLevel || currentLevel
    if (summary.conversationType === ConversationType.DM) {
      const dmUserId = summary.topic || summary.conversationId
      registerUserName(dmUserId, summary.title)
      const next: DirectMessage = {
        id: summary.conversationId,
        userId: dmUserId,
        displayName: summary.title,
        avatarUrl: resolveAvatarUrl(dmUserId),
        presence: resolveConversationPresence(summary.presence, dmUserId),
        unread,
        hasUnreadThreadReplies,
        lastMessageSeq: summary.lastMessageSeq,
        notificationLevel,
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
      notificationLevel,
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
    if (counter.hasUnreadThreadReplies && activeThreadConversationId.value === counter.conversationId && activeThreadRootId.value) {
      maybeRecoverActiveThread(activeThreadRootId.value, counter.conversationId)
    }
    scheduleUnreadFeedRefresh()
  }

  function applyNotificationAdded(evt: NotificationAddedEvent) {
    if (!evt.notification) return
    const senderName = decodeNotificationText(evt.notification.title) || 'Msgnr'
    const body = decodeNotificationText(evt.notification.body)
    notifications.value = [
      notificationSummaryToItem(evt.notification),
      ...notifications.value.filter(item => item.id !== evt.notification?.notificationId),
    ]
    const isHighPriorityNotification =
      evt.notification.type === NotificationType.MENTION
      || evt.notification.type === NotificationType.THREAD_REPLY
    const shouldEmitIncoming = isHighPriorityNotification || !isClientTabActive()
    if (shouldEmitIncoming) {
      emitIncomingMessageNotification({
        reason: evt.notification.type === NotificationType.MENTION ? 'mention' : 'notification',
        conversationId: evt.notification.conversationId,
        senderId: '',
        senderName,
        body,
        attachmentCount: 0,
      })
    }
    const conversationId = evt.notification.conversationId
    if (!conversationId) return
    scheduleUnreadFeedRefresh()
    if (conversationExists(conversationId)) return
    const ws = useWsStore()
    if (ws.state === 'BOOTSTRAPPING' || ws.state === 'RECOVERING_GAP' || ws.state === 'STALE_REBOOTSTRAP') return
    startBootstrap()
  }

  function applyMessageAlert(evt: MessageAlertEvent) {
    if (isClientTabActive()) return
    emitIncomingMessageNotification({
      reason: 'message_alert',
      conversationId: evt.conversationId,
      messageId: evt.messageId,
      threadRootMessageId: evt.threadRootMessageId || undefined,
      senderId: evt.senderId,
      senderName: decodeNotificationText(evt.senderName),
      body: decodeNotificationText(evt.body),
      attachmentCount: evt.attachmentCount,
    })
  }

  function applyNotificationLevelChanged(evt: NotificationLevelChangedEvent) {
    const channel = channels.value.find(c => c.id === evt.conversationId)
    if (channel) {
      channel.notificationLevel = evt.level
    }
    const dm = directMessages.value.find(d => d.id === evt.conversationId)
    if (dm) {
      dm.notificationLevel = evt.level
    }
    scheduleUnreadFeedRefresh()
  }

  // Tracks the pending notification level request for optimistic rollback.
  // Only one request can be in-flight at a time (the UI shows one dropdown).
  // If the server doesn't confirm within NOTIFICATION_LEVEL_TIMEOUT_MS, or
  // returns an error, the optimistic update is rolled back.
  const NOTIFICATION_LEVEL_TIMEOUT_MS = 10_000
  let pendingNotificationLevelChange: {
    requestId: string
    conversationId: string
    previousLevel: NotificationLevel
    timer: ReturnType<typeof setTimeout>
  } | null = null

  function setNotificationLevel(conversationId: string, level: NotificationLevel) {
    // Cancel any previous in-flight request.
    clearPendingNotificationLevelChange()

    const previous = currentNotificationLevel(conversationId)

    // Optimistic update
    const channel = channels.value.find(c => c.id === conversationId)
    if (channel) channel.notificationLevel = level
    const dm = directMessages.value.find(d => d.id === conversationId)
    if (dm) dm.notificationLevel = level

    // Send WS command — returns the requestId for correlation.
    const requestId = useWsStore().sendSetNotificationLevel(conversationId, level)

    // Start a rollback timer. If the server doesn't respond, revert.
    const timer = setTimeout(() => {
      if (pendingNotificationLevelChange?.requestId === requestId) {
        rollbackNotificationLevel(conversationId, previous)
        pendingNotificationLevelChange = null
      }
    }, NOTIFICATION_LEVEL_TIMEOUT_MS)

    pendingNotificationLevelChange = { requestId, conversationId, previousLevel: previous, timer }
  }

  function handleSetNotificationLevelResponse(_resp: import('@/shared/proto/packets_pb').SetNotificationLevelResponse) {
    // Server confirmed. Clear the pending state — the optimistic update stands.
    clearPendingNotificationLevelChange()
  }

  function clearPendingNotificationLevelChange() {
    if (pendingNotificationLevelChange) {
      clearTimeout(pendingNotificationLevelChange.timer)
      pendingNotificationLevelChange = null
    }
  }

  function rollbackNotificationLevel(conversationId: string, level: NotificationLevel) {
    const ch = channels.value.find(c => c.id === conversationId)
    if (ch) ch.notificationLevel = level
    const dm = directMessages.value.find(d => d.id === conversationId)
    if (dm) dm.notificationLevel = level
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

  function applyUserCallPresenceChanged(evt: UserCallPresenceChangedEvent) {
    if (evt.activeCallCount > 0) {
      userCallPresenceByUserId.value[evt.userId] = evt.activeCallCount
      return
    }
    delete userCallPresenceByUserId.value[evt.userId]
  }

  function applyInviteCreated(evt: CallInviteCreatedEvent) {
    if (!evt.invite) return
    pendingInvites.value = [
      callInviteSummaryToItem(evt.invite),
      ...pendingInvites.value.filter(item => item.id !== evt.invite?.inviteId),
    ]
  }

  function onIncomingMessageNotification(handler: IncomingMessageNotificationHandler): () => void {
    incomingMessageNotificationHandlers.add(handler)
    return () => {
      incomingMessageNotificationHandlers.delete(handler)
    }
  }

  function emitIncomingMessageNotification(evt: IncomingMessageNotification) {
    for (const handler of incomingMessageNotificationHandlers) {
      try {
        handler(evt)
      } catch {
        // Best effort callback fanout: one listener failure must not break chat flow.
      }
    }
  }

  function onTaskStatusChanged(handler: TaskStatusChangedNotificationHandler): () => void {
    taskStatusChangedNotificationHandlers.add(handler)
    return () => {
      taskStatusChangedNotificationHandlers.delete(handler)
    }
  }

  function emitTaskStatusChangedNotification(evt: TaskStatusChangedEvent) {
    const updatedAt = evt.updatedAt
      ? new Date(Number(evt.updatedAt.seconds) * 1000).toISOString()
      : new Date().toISOString()
    const payload: TaskStatusChangedNotification = {
      taskId: evt.taskId,
      publicId: evt.publicId,
      fromStatusId: evt.fromStatusId,
      toStatusId: evt.toStatusId,
      updatedBy: evt.updatedBy,
      updatedAt,
    }
    for (const handler of taskStatusChangedNotificationHandlers) {
      try {
        handler(payload)
      } catch {
        // Best effort callback fanout: one listener failure must not break chat flow.
      }
    }
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
        requestConversationComposerFocus()
        saveActiveConversationSelection(fallbackConversation)
      } else {
        clearActiveConversationSelection()
      }
    }
    scheduleUnreadFeedRefresh()
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
    showConversationView()
    clearFocusedMessages()
    requestConversationComposerFocus()
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

  function currentNotificationLevel(conversationId: string): NotificationLevel {
    return channels.value.find(channel => channel.id === conversationId)?.notificationLevel
      ?? directMessages.value.find(dm => dm.id === conversationId)?.notificationLevel
      ?? NotificationLevel.ALL
  }

  function conversationExists(conversationId: string): boolean {
    return channels.value.some(channel => channel.id === conversationId) || directMessages.value.some(dm => dm.id === conversationId)
  }

  function presenceEventTimestampMs(evt?: PresenceEvent): number {
    if (!evt?.lastActiveAt) return -1
    const seconds = Number(evt.lastActiveAt.seconds ?? 0)
    const nanos = Number(evt.lastActiveAt.nanos ?? 0)
    return seconds * 1000 + Math.floor(nanos / 1_000_000)
  }

  function newerPresenceEvent(current: PresenceEvent | undefined, incoming: PresenceEvent): PresenceEvent {
    if (!current) return incoming
    const currentTs = presenceEventTimestampMs(current)
    const incomingTs = presenceEventTimestampMs(incoming)
    if (incomingTs > currentTs) return incoming
    if (incomingTs < currentTs) return current
    return incoming
  }

  function resolveConversationPresence(
    summaryPresence: PresenceStatus,
    userId: string,
  ): 'online' | 'away' | 'offline' {
    const effectivePresence = presenceByUserId.value[userId]?.effectivePresence ?? summaryPresence
    return effectivePresence === PresenceStatus.ONLINE
      ? 'online'
      : effectivePresence === PresenceStatus.AWAY
        ? 'away'
        : 'offline'
  }

  function _onMessageCreated(evt: ProtoMessageEvent) {
    const channelId = evt.conversationId
    const msg = _messageEventToMessage(evt, channelId)

    if (evt.threadRootMessageId) {
      const rootId = evt.threadRootMessageId
      const alreadyPresentInThread = (threadMessages.value[rootId] ?? []).some(item => item.id === evt.messageId)
      _upsertThreadMessage(rootId, msg)
      const known = threadSummaries.value[rootId]
      const nextLastThreadSeq = known?.lastThreadSeq && known.lastThreadSeq > evt.threadSeq
        ? known.lastThreadSeq
        : evt.threadSeq
      const knownReplyCount = known?.replyCount ?? 0
      const optimisticReplyCount = alreadyPresentInThread
        ? knownReplyCount
        : knownReplyCount + 1
      upsertThreadSummary(rootId, {
        replyCount: Math.max(optimisticReplyCount, 0),
        lastThreadSeq: nextLastThreadSeq,
        lastReplyAt: msg.createdAt,
        lastReplyUserId: evt.senderId,
      })
      if (nextLastThreadSeq <= highestConfirmedThreadSeq(rootId)) {
        clearThreadReplayResyncTimer(rootId)
      } else {
        maybeRecoverActiveThread(rootId, channelId)
      }
      scheduleUnreadFeedRefresh()
      return
    }

    if (!messages.value[channelId]) messages.value[channelId] = []
    const alreadyPresent = messages.value[channelId].some(m => m.id === evt.messageId)
    if (alreadyPresent) return

    messages.value[channelId].push(msg)
    // Write-through to IndexedDB (fire-and-forget)
    void cacheSingleMessage(msg)
    const channel = channels.value.find(item => item.id === channelId)
    if (channel) channel.lastMessageSeq = evt.channelSeq
    const dm = directMessages.value.find(item => item.id === channelId)
    if (dm) dm.lastMessageSeq = evt.channelSeq
    if (channelId === activeChannelId.value) {
      if (isClientTabActive()) {
        requestReadMark(channelId, evt.channelSeq)
      } else {
        queuePendingReadMark(channelId, evt.channelSeq)
      }
      scheduleUnreadFeedRefresh()
      return
    }
    scheduleUnreadFeedRefresh()
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

  async function markUnreadFeedItemRead(item: UnreadFeedItem): Promise<void> {
    if (!item?.id || !item.conversationId) return
    const rootMessageId = item.threadRootMessageId || item.messageId
    if (rootMessageId) {
      const rootMessage = (messages.value[item.conversationId] ?? []).find(message => message.id === rootMessageId)
      await markThreadUnreadAsRead(item.conversationId, rootMessageId, rootMessage?.channelSeq ?? 0n)
      return
    }

    if (item.notificationId) {
      await resolveUnreadFeedNotification(item.notificationId)
      removeUnreadFeedItemLocally(item.id, item.notificationId)
    }
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
    const eventLastSeq = evt.lastThreadSeq >= 0n ? evt.lastThreadSeq : 0n
    const knownLastSeq = threadSummaries.value[root]?.lastThreadSeq ?? 0n
    upsertThreadSummary(root, {
      replyCount: Math.max(0, Math.floor(Number(evt.replyCount))),
      lastThreadSeq: knownLastSeq > eventLastSeq ? knownLastSeq : eventLastSeq,
      lastReplyAt: evt.lastThreadReplyAt
        ? new Date(Number(evt.lastThreadReplyAt.seconds) * 1000).toISOString()
        : undefined,
      lastReplyUserId: evt.lastThreadReplyUserId,
    })
    maybeRecoverActiveThread(root, evt.conversationId)
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

  function _onMessageUpdated(evt: MessageUpdatedEvent) {
    const apply = (msg: Message) => {
      const entities = normalizeMessageEntities(evt.entities)
      msg.body = evt.body
      msg.entities = entities
      msg.mentionedUserIds = mentionedUserIdsFromPayload(evt.entities, evt.mentionedUserIds)
      msg.mentionEveryone = evt.mentionEveryone ?? false
      if (evt.editedAt) {
        msg.editedAt = new Date(Number(evt.editedAt.seconds) * 1000).toISOString()
      } else {
        msg.editedAt = undefined
      }
    }

    const list = messages.value[evt.conversationId]
    if (list) {
      const msg = list.find(item => item.id === evt.messageId)
      if (msg) {
        apply(msg)
        void cacheMessages(evt.conversationId, list)
      }
    }
    for (const rootId of Object.keys(threadMessages.value)) {
      const msg = threadMessages.value[rootId]?.find(item => item.id === evt.messageId)
      if (!msg) continue
      apply(msg)
    }
    scheduleUnreadFeedRefresh()
  }

  function _onMessageDeleted(evt: MessageDeletedEvent) {
    const conversationId = evt.conversationId
    const rootList = messages.value[conversationId]
    let removedRoot = false

    if (rootList) {
      const idx = rootList.findIndex(item => item.id === evt.messageId)
      if (idx !== -1) {
        rootList.splice(idx, 1)
        removedRoot = true
      }
      void cacheMessages(conversationId, rootList)
    }

    for (const rootId of Object.keys(threadMessages.value)) {
      const list = threadMessages.value[rootId]
      if (!list) continue
      const idx = list.findIndex(item => item.id === evt.messageId)
      if (idx !== -1) {
        list.splice(idx, 1)
      }
    }

    const shouldClearRootThread = removedRoot || activeThreadRootId.value === evt.messageId
    if (shouldClearRootThread) {
      clearThreadReplayResyncTimer(evt.messageId)
      const nextThreadMessages = { ...threadMessages.value }
      delete nextThreadMessages[evt.messageId]
      threadMessages.value = nextThreadMessages

      const nextThreadSummaries = { ...threadSummaries.value }
      delete nextThreadSummaries[evt.messageId]
      threadSummaries.value = nextThreadSummaries
      persistThreadSummaries()

    }

    if (activeThreadRootId.value === evt.messageId) {
      closeThread()
    }
    scheduleUnreadFeedRefresh()
  }

  function applyLocalMessageDeleted(conversationId: string, messageId: string, threadRootMessageId?: string) {
    _onMessageDeleted({
      conversationId,
      messageId,
      threadRootMessageId: threadRootMessageId ?? '',
    } as MessageDeletedEvent)
  }

  function applyLocalMessageEdited(
    conversationId: string,
    messageId: string,
    body: string,
    entities: MessageEntity[] = [],
    editedAt?: string,
  ) {
    _onMessageUpdated({
      conversationId,
      messageId,
      body,
      entities,
      mentionedUserIds: mentionedUserIdsFromEntities(entities),
      mentionEveryone: body.includes('@everyone') || body.includes('@channel'),
      editedAt: editedAt
        ? {
            seconds: BigInt(Math.floor(new Date(editedAt).getTime() / 1000)),
            nanos: 0,
          }
        : undefined,
    } as unknown as MessageUpdatedEvent)
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
      entities: normalizeMessageEntities(evt.entities),
      channelSeq: evt.channelSeq,
      threadSeq: evt.threadSeq,
      threadRootMessageId: evt.threadRootMessageId || undefined,
      mentionedUserIds: mentionedUserIdsFromPayload(evt.entities, evt.mentionedUserIds),
      mentionEveryone: evt.mentionEveryone ?? false,
      createdAt: evt.createdAt
        ? new Date(Number(evt.createdAt.seconds) * 1000).toISOString()
        : new Date().toISOString(),
      editedAt: evt.editedAt
        ? new Date(Number(evt.editedAt.seconds) * 1000).toISOString()
        : undefined,
      reactions: (evt.reactions ?? []).map(item => ({
        emoji: item.emoji,
        count: item.count,
      })),
      myReactions: [...(evt.myReactions ?? [])],
      attachments: (evt.attachments ?? []).map(item => ({
        id: item.attachmentId,
        fileName: item.fileName,
        fileSize: Number(item.fileSize),
        mimeType: item.mimeType,
      })),
      serverConfirmed: Boolean(evt.threadRootMessageId) || undefined,
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
      const prev = byId.get(item.id)
      byId.set(item.id, {
        id: item.id,
        channelId: item.conversation_id,
        senderId: item.sender_id,
        senderName: item.sender_name || resolveDisplayName(item.sender_id),
        senderAvatarUrl: resolveAvatarUrl(item.sender_id),
        body: item.body,
        entities: normalizeMessageEntities(item.entities),
        channelSeq: BigInt(item.channel_seq),
        threadSeq: BigInt(item.thread_seq),
        threadRootMessageId: item.thread_root_message_id || undefined,
        mentionedUserIds: mentionedUserIdsFromEntities(normalizeMessageEntities(item.entities)),
        mentionEveryone: item.mention_everyone,
        createdAt: item.created_at,
        editedAt: item.edited_at || undefined,
        reactions: item.reactions ?? prev?.reactions ?? [],
        myReactions: item.my_reactions ?? prev?.myReactions ?? [],
        attachments: (item.attachments ?? []).map(attachment => ({
          id: attachment.id,
          fileName: attachment.file_name,
          fileSize: attachment.file_size,
          mimeType: attachment.mime_type,
        })),
      })

      const threadReplyCount = Math.max(0, Math.floor(Number(item.thread_reply_count ?? 0)))
      const known = threadSummaries.value[item.id]
      if (threadReplyCount > 0 || known) {
        const eventLastSeq = BigInt(threadReplyCount)
        const knownLastSeq = known?.lastThreadSeq ?? 0n
        const nextLastSeq = knownLastSeq > eventLastSeq ? knownLastSeq : eventLastSeq
        upsertThreadSummary(item.id, {
          replyCount: threadReplyCount,
          lastThreadSeq: nextLastSeq,
          lastReplyAt: known?.lastReplyAt,
          lastReplyUserId: known?.lastReplyUserId,
        })
      }
    }

    messages.value[conversationId] = Array.from(byId.values()).sort((a, b) => Number(a.channelSeq - b.channelSeq))
    // Write-through to IndexedDB (fire-and-forget)
    void cacheMessages(conversationId, messages.value[conversationId])
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

  // ── App badge (PWA) ────────────────────────────────────────────────────────
  // Update the app icon badge count when the total unread changes.

  const totalUnreadCount = computed(() => unreadFeedTotalCount.value)

  watch(totalUnreadCount, (count) => {
    const platform = getPlatformOrNull()
    if (platform) {
      if (count > 0) {
        void platform.notifications.setBadge(count)
      } else {
        void platform.notifications.clearBadge()
      }
      return
    }

    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
      if (count > 0) {
        (navigator as any).setAppBadge(count).catch(() => {})
      } else {
        (navigator as any).clearAppBadge().catch(() => {})
      }
    }
  })

  return {
    channels,
    directMessages,
    chatViewMode,
    totalUnreadCount,
    activeChannelId,
    activeChannel,
    activeConversation,
    activeMessages,
    getConversationById,
    getMessagesForConversation,
    getTypingForConversation,
    getThreadRoot,
    getThreadReplies,
    isThreadPanelOpen,
    activeThreadRootId,
    activeThreadConversationId,
    activeThreadRootMessage,
    activeThreadReplies,
    activeThreadReplayVersion,
    focusedMessageId,
    focusedThreadMessageId,
    conversationComposerFocusToken,
    threadComposerFocusToken,
    unreadFeedItems,
    unreadFeedTotalCount,
    unreadFeedLoading,
    unreadFeedError,
    unreadFeedLoaded,
    unreadFeedRefreshQueued,
    workspace,
    notifications,
    activeCalls,
    userCallPresenceByUserId,
    pendingInvites,
    presenceByUserId,
    typingByConversationId,
    bootstrapped,
    cachedBootstrap,
    messages,
    threadMessages,
    threadReplayVersionByRoot,
    threadSummaries,
    userNames,
    userEmails,
    userAvatars,
    toast,
    lastAppliedEventSeq,
    lastAckedEventSeq,
    setChannels,
    showConversationView,
    showUnreadView,
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
    ensureThreadSubscribed,
    sendThreadReply,
    sendMessageToConversation,
    sendThreadReplyToRoot,
    startRealtimeFlow,
    setCachedBootstrap,
    startBootstrap,
    handleBootstrapResponse,
    handleSyncSinceResponse,
    handleAckResponse,
    handlePresenceEvent,
    handleTypingEvent,
    handleServerEvent,
    applyLocalMessageDeleted,
    applyLocalMessageEdited,
    handleSendMessageAck,
    handleReactionAck,
    handleSubscribeThreadResponse,
    registerWsHandlers,
    queueReactionOp,
    isReactionOpPending,
    showToast,
    isConversationHistoryLoading,
    isConversationInitialLoading,
    conversationHasMoreHistory,
    loadCachedState,
    applyBootstrapSnapshot,
    ensureConversationHistory,
    loadMessageContext,
    refreshUnreadFeed,
    scheduleUnreadFeedRefresh,
    markUnreadFeedItemRead,
    loadOlderConversationHistory,
    openDirectMessage,
    removeConversationLocal,
    onClientFocus,
    setClientActive,
    onIncomingMessageNotification,
    onTaskStatusChanged,
    focusConversationMessage,
    focusThreadMessage,
    requestConversationComposerFocus,
    requestThreadComposerFocus,
    clearFocusedMessages,
    resetRuntimeState,
    setNotificationLevel,
    updateSendStatus,
    updateThreadSendStatus,
    retryMessage,
    retryThreadMessage,
    discardFailedMessage,
    discardFailedThreadMessage,
    startSendTimeout,
    clearAllSendTimeouts,
  }
})

function notificationSummaryToItem(summary: NotificationSummary): NotificationItem {
  return {
    id: summary.notificationId,
    type: summary.type.toString(),
    title: decodeNotificationText(summary.title),
    body: decodeNotificationText(summary.body),
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
