<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4"
      @click.self="close"
    >
      <div class="flex max-h-[min(680px,calc(100vh-2rem))] w-full max-w-lg flex-col rounded-lg border border-chat-border bg-sidebar-bg shadow-2xl">
        <div class="flex items-center justify-between border-b border-chat-border px-4 py-3">
          <h2 class="text-sm font-semibold text-app-text">Forward message</h2>
          <button
            class="rounded p-1 text-app-muted hover:bg-white/10 hover:text-app-text"
            title="Close"
            @click="close"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="border-b border-chat-border p-3">
          <input
            v-model="query"
            class="w-full rounded-md border border-chat-border bg-chat-input px-3 py-2 text-sm text-app-text placeholder:text-app-muted focus:border-accent focus:outline-none"
            placeholder="Search conversations and threads"
            @keydown.esc="close"
          >
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div v-if="loading" class="px-3 py-6 text-center text-sm text-app-muted">
            Loading targets...
          </div>
          <div v-else-if="error" class="px-3 py-6 text-center text-sm text-red-300">
            {{ error }}
          </div>
          <div v-else-if="filteredConversations.length === 0 && filteredThreads.length === 0" class="px-3 py-6 text-center text-sm text-app-muted">
            No targets found
          </div>
          <template v-else>
            <section v-if="filteredConversations.length > 0" class="py-1">
              <h3 class="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-app-muted">Conversations</h3>
              <button
                v-for="target in filteredConversations"
                :key="`conversation:${target.conversation_id}`"
                class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-white/10"
                :class="selectedKey === `conversation:${target.conversation_id}` ? 'bg-accent/15 text-app-text' : 'text-app-text'"
                @click="selectedKey = `conversation:${target.conversation_id}`"
              >
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-chat-input text-xs font-semibold text-public_id">
                  {{ target.kind === 'dm' ? 'DM' : '#' }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm">{{ target.title }}</span>
                  <span class="block truncate text-xs text-app-muted">{{ target.kind === 'dm' ? 'Direct message' : target.visibility }}</span>
                </span>
              </button>
            </section>

            <section v-if="filteredThreads.length > 0" class="py-1">
              <h3 class="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-app-muted">Threads</h3>
              <button
                v-for="target in filteredThreads"
                :key="`thread:${target.conversation_id}:${target.thread_root_message_id}`"
                class="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-white/10"
                :class="selectedKey === `thread:${target.conversation_id}:${target.thread_root_message_id}` ? 'bg-accent/15 text-app-text' : 'text-app-text'"
                @click="selectedKey = `thread:${target.conversation_id}:${target.thread_root_message_id}`"
              >
                <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-chat-input text-public_id">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm">{{ target.conversation_title }}</span>
                  <span class="block truncate text-xs text-app-muted">{{ target.root_sender_name }}: {{ target.root_body || 'Attachment' }}</span>
                  <span class="block text-[11px] text-app-muted">{{ target.reply_count }} {{ target.reply_count === 1 ? 'reply' : 'replies' }}</span>
                </span>
              </button>
            </section>
          </template>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-chat-border px-4 py-3">
          <button
            class="rounded-md px-3 py-1.5 text-sm text-app-muted hover:bg-white/10 hover:text-app-text"
            :disabled="submitting"
            @click="close"
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!selectedKey || submitting"
            @click="submit"
          >
            {{ submitting ? 'Forwarding...' : 'Forward' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Message } from '@/stores/chat'
import { useChatStore } from '@/stores/chat'
import {
  listForwardTargets,
  type ForwardTargetConversationItem,
  type ForwardTargetThreadItem,
} from '@/services/http/chatApi'

const props = defineProps<{
  open: boolean
  message: Message
}>()

const emit = defineEmits<{
  close: []
}>()

const chatStore = useChatStore()
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const query = ref('')
const selectedKey = ref('')
const conversations = ref<ForwardTargetConversationItem[]>([])
const threads = ref<ForwardTargetThreadItem[]>([])

const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const filteredConversations = computed(() => {
  const needle = normalizedQuery.value
  if (!needle) return conversations.value
  return conversations.value.filter(target =>
    target.title.toLowerCase().includes(needle),
  )
})
const filteredThreads = computed(() => {
  const needle = normalizedQuery.value
  if (!needle) return threads.value
  return threads.value.filter(target =>
    target.conversation_title.toLowerCase().includes(needle)
    || target.root_sender_name.toLowerCase().includes(needle)
    || target.root_body.toLowerCase().includes(needle),
  )
})

async function loadTargets() {
  loading.value = true
  error.value = ''
  selectedKey.value = ''
  try {
    const data = await listForwardTargets()
    conversations.value = data.conversations
    threads.value = data.threads
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load targets'
  } finally {
    loading.value = false
  }
}

function close() {
  if (submitting.value) return
  emit('close')
}

async function submit() {
  if (!selectedKey.value || submitting.value) return
  const [kind, conversationId, rootMessageId = ''] = selectedKey.value.split(':')
  if (!conversationId) return
  submitting.value = true
  error.value = ''
  try {
    await chatStore.forwardMessageToTarget(
      props.message,
      conversationId,
      kind === 'thread' ? rootMessageId : '',
    )
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to forward message'
  } finally {
    submitting.value = false
  }
}

watch(() => props.open, (open) => {
  if (!open) return
  query.value = ''
  void loadTargets()
}, { immediate: true })

watch(normalizedQuery, () => {
  selectedKey.value = ''
})
</script>
