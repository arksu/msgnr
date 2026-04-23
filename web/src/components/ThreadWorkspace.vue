<template>
  <div class="flex h-full min-h-0 flex-col bg-chat-header">
    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto" @scroll.passive="handleScroll">
      <div v-if="!rootMessage" class="px-4 py-6 text-xs text-gray-400">
        Root message not available.
      </div>

      <template v-else>
        <div class="border-b border-chat-border/50 px-2 py-2">
          <MessageBubble
            :message="rootMessage"
            :show-header="true"
            :show-thread-action="false"
            :show-first-reaction-action="false"
          />
        </div>

        <div class="flex items-center gap-3 px-4 py-2">
          <div class="h-px flex-1 bg-chat-border" />
          <span class="shrink-0 text-[11px] text-gray-500">
            {{ replyCount === 0 ? 'No replies yet' : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` }}
          </span>
          <div class="h-px flex-1 bg-chat-border" />
        </div>

        <div v-if="replies.length > 0" class="pb-2">
          <div
            v-for="(reply, idx) in replies"
            :key="reply.id"
            :data-thread-message-id="reply.id"
          >
            <MessageBubble
              :message="reply"
              :show-header="shouldShowHeader(idx)"
              :show-thread-action="false"
              :show-first-reaction-action="true"
            />
          </div>
        </div>

        <div v-else class="px-4 pb-4 text-center text-xs text-gray-500">
          Be the first to reply
        </div>
      </template>
    </div>

    <MessageInput
      :channel-name="rootMessage?.senderName ?? 'thread'"
      :conversation-id="conversationId"
      :draft-scope="threadDraftScope"
      :disabled="!conversationId || !rootMessageId"
      :typing-label="typingLabel"
      :online="wsStore.state !== 'DISCONNECTED' && wsStore.state !== 'CONNECTING'"
      @send="handleSend"
      @typing="handleTyping"
      @resize="handleComposerResize"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ChatDraftScope } from '@/services/storage/chatDraftStorage'
import { useChatStore, type Message } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'
import MessageBubble from '@/components/MessageBubble.vue'
import MessageInput from '@/components/MessageInput.vue'

const props = defineProps<{
  conversationId: string
  rootMessageId: string
  mode?: 'main' | 'pinned'
}>()

const chatStore = useChatStore()
const wsStore = useWsStore()
const scrollEl = ref<HTMLElement | null>(null)
const isNearBottom = ref(true)
let typingIdleTimer: ReturnType<typeof setTimeout> | null = null
let typingIsActive = false
let typingLastSentAtMs = 0

const rootMessage = computed(() => chatStore.getThreadRoot(props.conversationId, props.rootMessageId))
const replies = computed(() => chatStore.getThreadReplies(props.rootMessageId))
const threadDraftScope = computed<ChatDraftScope>(() => ({
  kind: 'thread',
  conversationId: props.conversationId,
  rootMessageId: props.rootMessageId,
}))
const replyCount = computed(() => (
  chatStore.threadSummaries[props.rootMessageId]?.replyCount ?? replies.value.length
))
const typingLabel = computed(() => {
  // Current typing presence is conversation-scoped, not thread-scoped.
  const entries = chatStore.getTypingForConversation(props.conversationId)
    .filter(entry => entry.userId !== chatStore.workspace?.selfUserId)
  if (entries.length === 0) return ''
  if (entries.length === 1) return `${chatStore.resolveDisplayName(entries[0].userId)} is typing...`
  return `${entries.length} people are typing...`
})

function shouldShowHeader(idx: number): boolean {
  if (idx === 0) return true
  const prev = replies.value[idx - 1]
  const curr = replies.value[idx]
  if (!prev || !curr) return true
  if (prev.senderId !== curr.senderId) return true
  return new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60 * 1000
}

function scrollToBottom() {
  const el = scrollEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function handleScroll() {
  const el = scrollEl.value
  if (!el) return
  isNearBottom.value = el.scrollHeight - (el.scrollTop + el.clientHeight) <= 72
}

function handleComposerResize(deltaPx: number) {
  if (!deltaPx || !isNearBottom.value) return
  scrollToBottom()
}

function stopTypingPresence(sendStop: boolean) {
  if (typingIdleTimer) {
    clearTimeout(typingIdleTimer)
    typingIdleTimer = null
  }
  if (sendStop && typingIsActive && props.conversationId && wsStore.state === 'LIVE_SYNCED') {
    wsStore.sendTyping(props.conversationId, false)
  }
  typingIsActive = false
  typingLastSentAtMs = 0
}

function scheduleTypingStop() {
  if (typingIdleTimer) clearTimeout(typingIdleTimer)
  typingIdleTimer = setTimeout(() => {
    typingIdleTimer = null
    if (!typingIsActive || !props.conversationId || wsStore.state !== 'LIVE_SYNCED') return
    wsStore.sendTyping(props.conversationId, false)
    typingIsActive = false
    typingLastSentAtMs = 0
  }, 1000)
}

function handleTyping(active: boolean) {
  if (!props.conversationId) return
  if (!active) {
    stopTypingPresence(true)
    return
  }
  if (wsStore.state !== 'LIVE_SYNCED') return
  const now = Date.now()
  if (!typingIsActive || now - typingLastSentAtMs >= 3000) {
    wsStore.sendTyping(props.conversationId, true)
    typingIsActive = true
    typingLastSentAtMs = now
  }
  scheduleTypingStop()
}

function handleSend(payload: { body: string; entities: NonNullable<Message['entities']>; attachmentIds: string[]; attachments: Array<{ id: string; fileName: string; fileSize: number; mimeType: string }> }) {
  chatStore.sendThreadReplyToRoot(props.conversationId, props.rootMessageId, payload.body, payload.attachmentIds, payload.attachments, payload.entities)
  stopTypingPresence(true)
  void nextTick(() => scrollToBottom())
}

watch(() => [props.conversationId, props.rootMessageId] as const, async ([conversationId, rootMessageId]) => {
  if (!conversationId || !rootMessageId) return
  await chatStore.ensureConversationHistory(conversationId)
  if (!chatStore.getThreadRoot(conversationId, rootMessageId)) {
    await chatStore.loadMessageContext(conversationId, rootMessageId)
  }
  chatStore.ensureThreadSubscribed(conversationId, rootMessageId)
  await nextTick()
  scrollToBottom()
}, { immediate: true })

watch(() => replies.value.length, async () => {
  if (!isNearBottom.value) return
  await nextTick()
  scrollToBottom()
})

onBeforeUnmount(() => {
  stopTypingPresence(true)
})
</script>
