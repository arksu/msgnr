<template>
  <div class="flex h-full bg-chat-bg">
    <div class="flex min-w-0 flex-1 flex-col">

    <!-- Top bar -->
    <header class="flex items-center gap-3 px-4 py-3 border-b border-chat-border bg-chat-header shrink-0">
      <div class="flex items-center gap-1.5 font-bold text-white text-[15px] truncate">
        <span class="text-gray-400 font-normal text-lg">{{ conversationPrefix }}</span>
        {{ conversation?.title ?? '…' }}
      </div>
      <div v-if="conversation" class="h-5 w-px bg-chat-border mx-1 shrink-0" />
      <div class="ml-auto flex items-center gap-2 shrink-0">
        <button
          class="p-1.5 rounded transition-colors flex items-center gap-1 text-sm"
          :class="activeConversationCall ? 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25' : 'hover:bg-white/10 text-gray-400 hover:text-white'"
          :disabled="!conversation"
          @click="handleCallClick"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.63 2.63a2 2 0 0 1-.45 2.11L8.1 9.91a16 16 0 0 0 6 6l1.45-1.19a2 2 0 0 1 2.11-.45c.85.3 1.73.51 2.63.63A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span class="hidden sm:inline">{{ activeConversationCall ? 'Call active' : 'Call' }}</span>
        </button>
        <button class="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </button>
        <button
          class="p-1.5 rounded transition-colors flex items-center gap-1 text-sm"
          :class="isMembersPanelOpen ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-gray-400 hover:text-white'"
          :disabled="!conversation"
          @click="toggleMembersPanel"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <span class="hidden sm:inline">Members</span>
        </button>
      </div>
    </header>

    <!-- Reconnect banner -->
    <ConnectionBanner
      :is-reconnecting="isReconnecting"
      :reconnect-attempt="reconnectAttempt"
      :queue-length="offlineQueue.queue.value.length"
      @reconnect-now="reconnectNow"
    />

    <!-- Messages list -->
    <div class="relative flex-1 min-h-0">
      <div
        ref="scrollEl"
        class="h-full overflow-y-auto px-4 py-4 space-y-0.5"
        style="overflow-anchor: none; overscroll-behavior-y: contain;"
        @scroll.passive="handleScroll"
      >
        <template v-if="messages.length === 0">
          <div class="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
            <svg class="w-10 h-10" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
            </svg>
            <span class="text-sm">No messages yet. Start the conversation!</span>
            <span v-if="wsStore.state === 'BOOTSTRAPPING' || wsStore.state === 'RECOVERING_GAP' || wsStore.state === 'STALE_REBOOTSTRAP'" class="text-xs text-gray-600">
              {{ statusLabel }}
            </span>
          </div>
        </template>

        <template v-else>
          <div
            v-for="(msg, idx) in messages"
            :key="msg.id"
            :data-message-id="msg.id"
          >
            <MessageBubble
              :message="msg"
              :show-header="shouldShowHeader(idx)"
              :thread-reply-count="threadReplyCount(msg.id)"
              :is-active-thread="chatStore.activeThreadRootId === msg.id"
              @open-thread="openThreadFromMessage"
            />
          </div>
        </template>
      </div>

      <div
        v-if="loadingOlderHistory"
        data-testid="history-loading-spinner"
        class="pointer-events-none absolute top-2 left-0 right-0 z-10 flex justify-center"
      >
        <div class="inline-flex items-center gap-2 rounded-full border border-chat-border bg-chat-header/90 px-2.5 py-1 text-[11px] text-gray-300 backdrop-blur">
          <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" />
            <path class="opacity-90" d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
          <span>Loading history</span>
        </div>
      </div>

      <div
        v-if="showConversationLoadingOverlay"
        data-testid="conversation-loading-overlay"
        class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-chat-bg/65 backdrop-blur-[1px]"
      >
        <div class="inline-flex items-center gap-2 rounded-full border border-chat-border bg-chat-header/90 px-3 py-1.5 text-xs text-gray-200">
          <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" />
            <path class="opacity-90" d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
          <span>Loading conversation...</span>
        </div>
      </div>
    </div>

    <!-- Message input -->
    <MessageInput
      :channel-name="conversation?.title ?? 'conversation'"
      :conversation-id="chatStore.activeChannelId"
      :disabled="!canComposeMessage"
      :typing-label="typingLabel"
      :online="wsStore.state !== 'DISCONNECTED' && wsStore.state !== 'CONNECTING'"
      @send="handleSend"
      @typing="handleTyping"
    />
    </div>

    <ThreadPanel
      v-if="isThreadPanelOpen"
      @close="closeThreadPanel"
    />

    <MembersPanel
      v-if="isMembersPanelOpen"
      :visibility="conversation?.visibility"
      @close="closeMembersPanel"
    />

    <div
      v-if="channelCallDialogOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeChannelCallDialog"
    >
      <div class="w-full max-w-md overflow-hidden rounded-xl border border-chat-border bg-chat-header shadow-2xl">
        <div class="border-b border-chat-border px-4 py-3">
          <div class="text-sm font-semibold text-white">Start team call</div>
          <div class="mt-1 text-xs text-gray-400">Select members to invite. You will be added automatically.</div>
        </div>

        <div v-if="channelCallError" class="border-b border-chat-border px-4 py-2 text-xs text-red-300">
          {{ channelCallError }}
        </div>

        <div class="max-h-72 overflow-y-auto">
          <button
            v-for="member in channelCallMembers"
            :key="member.userId"
            class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5"
            @click="toggleChannelCallInvitee(member.userId)"
          >
            <input
              type="checkbox"
              class="h-4 w-4"
              :checked="selectedChannelCallInvitees.includes(member.userId)"
              @click.stop
              @change="toggleChannelCallInvitee(member.userId)"
            >
            <UserAvatar
              :user-id="member.userId"
              :display-name="member.displayName || member.email"
              :avatar-url="member.avatarUrl"
              size="sm"
            />
            <div class="min-w-0">
              <div class="truncate text-sm text-white">{{ member.displayName || member.email }}</div>
              <div class="truncate text-xs text-gray-400">{{ member.email }}</div>
            </div>
          </button>

          <div v-if="!channelCallLoading && channelCallMembers.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">
            No other members available
          </div>
          <div v-if="channelCallLoading" class="px-4 py-6 text-center text-xs text-gray-400">
            Loading members...
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t border-chat-border px-4 py-3">
          <button class="rounded px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10" @click="closeChannelCallDialog">
            Cancel
          </button>
          <button
            class="rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
            :disabled="channelCallLoading || startingChannelCall"
            @click="startChannelCall"
          >
            Start call
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useChatStore, type Message } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useWsStore } from '@/stores/ws'
import { useCallStore } from '@/stores/call'
import { listConversationMembers } from '@/services/http/chatApi'
import { generateId } from '@/services/id'
import MessageBubble from './MessageBubble.vue'
import MessageInput from './MessageInput.vue'
import ThreadPanel from './ThreadPanel.vue'
import MembersPanel from './MembersPanel.vue'
import ConnectionBanner from './ConnectionBanner.vue'
import UserAvatar from './UserAvatar.vue'
import { useSessionOrchestrator } from '@/composables/useSessionOrchestrator'
import { useOfflineQueue } from '@/composables/useOfflineQueue'

const chatStore = useChatStore()
const authStore = useAuthStore()
const wsStore = useWsStore()
const callStore = useCallStore()
const { isReconnecting, reconnectAttempt, reconnectNow } = useSessionOrchestrator()
const offlineQueue = useOfflineQueue()
const scrollEl = ref<HTMLElement | null>(null)
const openRenderProbe = ref<{ conversationId: string; startedAt: number } | null>(null)
const loadingOlderHistory = ref(false)
const forceScrollToBottomOnNextRender = ref(false)
let forceScrollResetTimer: ReturnType<typeof setTimeout> | null = null
const TOP_PRELOAD_THRESHOLD_PX = 120
const TOP_PRELOAD_REARM_GAP_PX = 72
const BOTTOM_STICK_THRESHOLD_PX = 72
const topPreloadArmed = ref(true)

interface ScrollAnchor {
  messageId: string
  offsetFromViewportTop: number
}

const conversation = computed(() => chatStore.activeConversation)
const messages = computed(() => chatStore.activeMessages)
const isThreadPanelOpen = computed(() => chatStore.isThreadPanelOpen)
const isMembersPanelOpen = ref(false)
function toggleMembersPanel() { isMembersPanelOpen.value = !isMembersPanelOpen.value }
function closeMembersPanel() { isMembersPanelOpen.value = false }
const conversationPrefix = computed(() => conversation.value?.kind === 'dm' ? '@' : '#')
const canComposeMessage = computed(() => Boolean(conversation.value))
const activeConversationCall = computed(() => {
  const conversationId = conversation.value?.id
  if (!conversationId) return null
  return chatStore.activeCalls.find(call => call.conversationId === conversationId) ?? null
})
const typingLabel = computed(() => {
  const entries = chatStore.typingByConversationId[chatStore.activeChannelId] ?? []
  const visible = entries.filter(entry => entry.userId !== chatStore.workspace?.selfUserId)
  if (visible.length === 0) return ''
  if (visible.length === 1) {
    return `${chatStore.resolveDisplayName(visible[0].userId)} is typing...`
  }
  return `${visible.length} people are typing...`
})
const threadReplyCountsFromTimeline = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const msg of messages.value) {
    const rootId = msg.threadRootMessageId
    if (!rootId || rootId === msg.id) continue
    counts[rootId] = (counts[rootId] ?? 0) + 1
  }
  return counts
})
const channelCallDialogOpen = ref(false)
const channelCallLoading = ref(false)
const startingChannelCall = ref(false)
const channelCallError = ref('')
const channelCallMembers = ref<Array<{ userId: string; displayName: string; email: string; avatarUrl: string }>>([])
const selectedChannelCallInvitees = ref<string[]>([])
const statusLabel = computed(() => {
  switch (wsStore.state) {
    case 'BOOTSTRAPPING':
      return 'Loading conversations...'
    case 'RECOVERING_GAP':
      return 'Recovering missed events...'
    case 'STALE_REBOOTSTRAP':
      return 'Refreshing snapshot...'
    default:
      return ''
  }
})
const showConversationLoadingOverlay = computed(() =>
  chatStore.isConversationInitialLoading(chatStore.activeChannelId)
)

function shouldShowHeader(idx: number): boolean {
  if (idx === 0) return true
  const prev = messages.value[idx - 1]
  const curr = messages.value[idx]
  if (prev.senderId !== curr.senderId) return true
  const prevTime = new Date(prev.createdAt).getTime()
  const currTime = new Date(curr.createdAt).getTime()
  return currTime - prevTime > 5 * 60 * 1000
}

function threadReplyCount(rootMessageId: string): number {
  const summaryCount = chatStore.threadSummaries[rootMessageId]?.replyCount ?? 0
  const timelineCount = threadReplyCountsFromTimeline.value[rootMessageId] ?? 0
  return Math.max(summaryCount, timelineCount)
}

function openThreadFromMessage(message: Message) {
  chatStore.openThread(message)
}

function closeThreadPanel() {
  chatStore.closeThread()
}

function handleSend(
  body: string | { body: string; attachmentIds: string[]; attachments: Array<{ id: string; fileName: string; fileSize: number; mimeType: string }> },
) {
  const payload = typeof body === 'string'
    ? { body, attachmentIds: [], attachments: [] as Array<{ id: string; fileName: string; fileSize: number; mimeType: string }> }
    : body
  const messageBody = payload.body
  const channelId = chatStore.activeChannelId
  const user = authStore.user
  const senderId = user?.id ?? chatStore.workspace?.selfUserId ?? ''
  const senderName = (
    (user?.displayName?.trim() || '')
    || (chatStore.workspace?.selfDisplayName?.trim() || '')
    || (user?.email?.trim() || '')
    || senderId.slice(0, 8)
  )
  const senderAvatarUrl = (
    (user?.avatarUrl?.trim() || '')
    || (chatStore.workspace?.selfAvatarUrl?.trim() || '')
    || (chatStore.resolveAvatarUrl(senderId).trim() || '')
  )
  if (!channelId || !senderId) return

  if (!messageBody.trim() && payload.attachmentIds.length === 0) return
  if ((wsStore.state === 'DISCONNECTED' || wsStore.state === 'CONNECTING') && payload.attachmentIds.length > 0) {
    return
  }

  const clientMsgId = generateId()
  const now = new Date().toISOString()
  const isOffline = wsStore.state === 'DISCONNECTED' || wsStore.state === 'CONNECTING'
  scheduleGuaranteedBottomScroll()

  // Optimistic message — shown immediately regardless of connection state
  chatStore.addOptimisticMessage({
    id: clientMsgId,
    channelId,
    senderId,
    senderName,
    senderAvatarUrl: senderAvatarUrl || undefined,
    body: messageBody,
    channelSeq: 0n,
    threadSeq: 0n,
    mentionedUserIds: [],
    mentionEveryone: false,
    createdAt: now,
    reactions: [],
    myReactions: [],
    attachments: payload.attachments.map(att => ({
      id: att.id,
      fileName: att.fileName,
      fileSize: att.fileSize,
      mimeType: att.mimeType,
    })),
    clientMsgId,
    sendStatus: isOffline ? 'queued' : 'sending',
  })

  if (isOffline) {
    // Queue for delivery after reconnect
    offlineQueue.enqueue({ conversationId: channelId, body: messageBody, clientMsgId })
  } else {
    const sent = wsStore.sendMessage(channelId, messageBody, clientMsgId, undefined, payload.attachmentIds)
    if (!sent) {
      chatStore.updateSendStatus(channelId, clientMsgId, 'failed', 'Connection lost')
    } else {
      chatStore.startSendTimeout(channelId, clientMsgId, false)
    }
  }
}

function scheduleGuaranteedBottomScroll() {
  forceScrollToBottomOnNextRender.value = true
  if (forceScrollResetTimer) {
    clearTimeout(forceScrollResetTimer)
    forceScrollResetTimer = null
  }

  const runScroll = () => {
    scrollToBottom()
  }

  nextTick(() => {
    runScroll()
    requestAnimationFrame(() => {
      runScroll()
      requestAnimationFrame(() => {
        runScroll()
      })
    })
  })

  setTimeout(runScroll, 60)
  setTimeout(runScroll, 140)
  forceScrollResetTimer = setTimeout(() => {
    forceScrollToBottomOnNextRender.value = false
    forceScrollResetTimer = null
  }, 260)
}

// When ChatArea remounts (e.g. returning from task-tracker mode), the active
// channel hasn't changed so the channel-switch watcher won't fire. Scroll to
// the bottom explicitly so the user lands at the latest message.
onMounted(() => {
  scheduleGuaranteedBottomScroll()
})

function handleTyping(active: boolean) {
  const channelId = chatStore.activeChannelId
  if (!channelId || wsStore.state !== 'LIVE_SYNCED') return
  wsStore.sendTyping(channelId, active)
}

async function handleCallClick() {
  if (!conversation.value) return
  if (
    activeConversationCall.value
    && callStore.activeConversationId === conversation.value.id
    && (callStore.connected || callStore.connecting)
  ) {
    return
  }
  if (conversation.value.kind === 'dm') {
    try {
      await callStore.startOrJoinCall({
        conversationId: conversation.value.id,
        kind: 'dm',
        visibility: 'dm',
      })
    } catch {
      // store surface handles call errors.
    }
    return
  }
  if (activeConversationCall.value) {
    try {
      await callStore.startOrJoinCall({
        conversationId: conversation.value.id,
        kind: 'channel',
        visibility: conversation.value.visibility,
      })
    } catch {
      // store surface handles call errors.
    }
    return
  }
  await openChannelCallDialog()
}

async function openChannelCallDialog() {
  if (!conversation.value) return
  channelCallDialogOpen.value = true
  channelCallLoading.value = true
  channelCallError.value = ''
  selectedChannelCallInvitees.value = []
  try {
    const members = await listConversationMembers(conversation.value.id)
    const selfUserId = authStore.user?.id ?? chatStore.workspace?.selfUserId ?? ''
    channelCallMembers.value = members
      .filter(member => member.user_id !== selfUserId)
      .map(member => ({
        userId: member.user_id,
        displayName: member.display_name,
        email: member.email,
        avatarUrl: member.avatar_url,
      }))
  } catch (err) {
    channelCallError.value = err instanceof Error ? err.message : 'Failed to load members'
    channelCallMembers.value = []
  } finally {
    channelCallLoading.value = false
  }
}

function closeChannelCallDialog() {
  channelCallDialogOpen.value = false
  channelCallError.value = ''
}

function toggleChannelCallInvitee(userId: string) {
  if (selectedChannelCallInvitees.value.includes(userId)) {
    selectedChannelCallInvitees.value = selectedChannelCallInvitees.value.filter(id => id !== userId)
    return
  }
  selectedChannelCallInvitees.value = [...selectedChannelCallInvitees.value, userId]
}

async function startChannelCall() {
  if (!conversation.value) return
  startingChannelCall.value = true
  channelCallError.value = ''
  try {
    await callStore.startOrJoinCall({
      conversationId: conversation.value.id,
      kind: 'channel',
      visibility: conversation.value.visibility,
      inviteeUserIds: selectedChannelCallInvitees.value,
    })
    closeChannelCallDialog()
  } catch (err) {
    channelCallError.value = err instanceof Error ? err.message : 'Failed to start call'
  } finally {
    startingChannelCall.value = false
  }
}

function scrollToBottom() {
  const el = scrollEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function isNearBottom(thresholdPx = BOTTOM_STICK_THRESHOLD_PX): boolean {
  const el = scrollEl.value
  if (!el) return true
  return el.scrollHeight - (el.scrollTop + el.clientHeight) <= thresholdPx
}

async function preloadOlderHistory() {
  const conversationId = chatStore.activeChannelId
  const el = scrollEl.value
  if (!conversationId || !el || loadingOlderHistory.value) return
  if (el.scrollTop > TOP_PRELOAD_THRESHOLD_PX) return

  loadingOlderHistory.value = true
  const anchor = captureTopVisibleAnchor(el)
  const previousHeight = el.scrollHeight
  const previousTop = el.scrollTop
  try {
    const loadedCount = await chatStore.loadOlderConversationHistory(conversationId)
    if (loadedCount <= 0) return
    await nextTick()
    const current = scrollEl.value
    if (!current) return
    if (!restoreAnchorPosition(current, anchor)) {
      current.scrollTop = previousTop + (current.scrollHeight - previousHeight)
    }
  } finally {
    loadingOlderHistory.value = false
  }
}

function handleScroll() {
  const el = scrollEl.value
  if (!el) return
  if (el.scrollTop > TOP_PRELOAD_THRESHOLD_PX + TOP_PRELOAD_REARM_GAP_PX) {
    topPreloadArmed.value = true
  }
  if (loadingOlderHistory.value || !topPreloadArmed.value) return
  if (el.scrollTop <= TOP_PRELOAD_THRESHOLD_PX) {
    topPreloadArmed.value = false
    void preloadOlderHistory()
  }
}

function captureTopVisibleAnchor(container: HTMLElement): ScrollAnchor | null {
  const containerRect = container.getBoundingClientRect()
  const rows = container.querySelectorAll<HTMLElement>('[data-message-id]')
  for (const row of rows) {
    const messageId = row.dataset.messageId?.trim()
    if (!messageId) continue
    const rowRect = row.getBoundingClientRect()
    if (rowRect.bottom >= containerRect.top) {
      return {
        messageId,
        offsetFromViewportTop: rowRect.top - containerRect.top,
      }
    }
  }
  return null
}

function restoreAnchorPosition(container: HTMLElement, anchor: ScrollAnchor | null): boolean {
  if (!anchor) return false
  const rows = container.querySelectorAll<HTMLElement>('[data-message-id]')
  let target: HTMLElement | null = null
  for (const row of rows) {
    if (row.dataset.messageId === anchor.messageId) {
      target = row
      break
    }
  }
  if (!target) return false
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const delta = (targetRect.top - containerRect.top) - anchor.offsetFromViewportTop
  if (Math.abs(delta) < 0.5) return true
  container.scrollTop += delta
  return true
}

watch(() => {
  const list = messages.value
  const last = list[list.length - 1]
  return `${chatStore.activeChannelId}|${list.length}|${last?.id ?? ''}`
}, async () => {
  const shouldStick = isNearBottom()
  await nextTick()
  if ((shouldStick || forceScrollToBottomOnNextRender.value) && !loadingOlderHistory.value) {
    scrollToBottom()
  }
  const probe = openRenderProbe.value
  if (probe && probe.conversationId === chatStore.activeChannelId) {
    requestAnimationFrame(() => {
      const elapsedMs = Math.round((performance.now() - probe.startedAt) * 100) / 100
      console.debug('[perf][conversation-open] render:messages-updated', {
        conversationId: probe.conversationId,
        messageCount: messages.value.length,
        elapsedMs,
      })
    })
  }
})

watch(() => chatStore.activeChannelId, async (conversationId) => {
  const startedAt = performance.now()
  openRenderProbe.value = { conversationId, startedAt }
  topPreloadArmed.value = true
  scheduleGuaranteedBottomScroll()
  console.debug('[perf][conversation-open] render:active-channel-changed', {
    conversationId,
    at: new Date().toISOString(),
    currentMessageCount: messages.value.length,
  })
  await nextTick()
  void preloadOlderHistory()
  requestAnimationFrame(() => {
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100
    console.debug('[perf][conversation-open] render:first-frame', {
      conversationId,
      messageCount: messages.value.length,
      elapsedMs,
    })
  })
})
</script>
