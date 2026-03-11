<template>
  <aside class="w-[360px] max-w-[42vw] border-l border-chat-border bg-chat-header flex flex-col">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-chat-border shrink-0">
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="text-sm font-semibold text-white">Thread</span>
      </div>
      <button
        class="h-7 w-7 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
        title="Close thread"
        @click="$emit('close')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </header>

    <!-- Scrollable body -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="!rootMessage" class="px-4 py-6 text-xs text-gray-400">
        Root message not available.
      </div>

      <template v-else>
        <!-- Root message -->
        <div class="px-2 py-2 border-b border-chat-border/50">
          <MessageBubble
            :message="rootMessage"
            :show-header="true"
            :show-thread-action="false"
          />
        </div>

        <!-- Replies divider -->
        <div class="flex items-center gap-3 px-4 py-2">
          <div class="flex-1 h-px bg-chat-border" />
          <span class="text-[11px] text-gray-500 shrink-0">
            {{ replyCount === 0 ? 'No replies yet' : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` }}
          </span>
          <div class="flex-1 h-px bg-chat-border" />
        </div>

        <!-- Thread replies -->
        <div v-if="replies.length > 0" class="pb-2">
          <MessageBubble
            v-for="(reply, idx) in replies"
            :key="reply.id"
            :message="reply"
            :show-header="shouldShowHeader(idx)"
            :show-thread-action="false"
          />
        </div>

        <div v-else class="px-4 pb-4 text-xs text-gray-500 text-center">
          Be the first to reply
        </div>
      </template>
    </div>

    <MessageInput
      :channel-name="rootMessage?.senderName ?? 'thread'"
      :conversation-id="chat.activeThreadConversationId"
      :disabled="!chat.activeThreadConversationId"
      :online="ws.state !== 'DISCONNECTED' && ws.state !== 'CONNECTING'"
      @send="sendReply"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore, type Message } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'
import MessageBubble from './MessageBubble.vue'
import MessageInput from './MessageInput.vue'

defineEmits<{ close: [] }>()

const chat = useChatStore()
const ws = useWsStore()

const rootMessage = computed(() => chat.activeThreadRootMessage)
const replies = computed(() => chat.activeThreadReplies)
const replyCount = computed(() =>
  chat.threadSummaries[rootMessage.value?.id ?? '']?.replyCount
  ?? replies.value.length
)

function sendReply(payload: { body: string; attachmentIds: string[]; attachments: Array<{ id: string; fileName: string; fileSize: number; mimeType: string }> }) {
  chat.sendThreadReply(payload.body, payload.attachmentIds, payload.attachments)
}

function shouldShowHeader(idx: number): boolean {
  if (idx === 0) return true
  const prev = replies.value[idx - 1] as Message
  const curr = replies.value[idx] as Message
  if (prev.senderId !== curr.senderId) return true
  const prevTime = new Date(prev.createdAt).getTime()
  const currTime = new Date(curr.createdAt).getTime()
  return currTime - prevTime > 5 * 60 * 1000
}
</script>
