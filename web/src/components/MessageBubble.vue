<template>
  <div
    class="relative flex gap-3 px-2 py-1 rounded group hover:bg-chat-msgHover transition-colors"
    :class="[
      showHeader ? 'mt-4' : 'mt-0.5',
      isActiveThread ? 'border-l-2 border-accent bg-accent/5' : '',
      message.sendStatus === 'failed' ? 'border-l-2 border-red-500/60' : '',
      message.sendStatus === 'queued' ? 'border-l-2 border-dashed border-gray-500/40' : '',
    ]"
    :style="bubbleStyle"
  >
    <!-- Active thread indicator -->
    <div
      v-if="isActiveThread"
      class="absolute left-0 top-0 bottom-0 flex items-start pt-2 pl-1 text-accent text-[10px] font-bold select-none"
    >
      ▶
    </div>

    <!-- Avatar column -->
    <div class="w-9 shrink-0 pt-0.5" :class="isActiveThread ? 'ml-3' : ''">
      <UserAvatar
        v-if="showHeader"
        :user-id="message.senderId"
        :display-name="message.senderName"
        :avatar-url="message.senderAvatarUrl"
        size="lg"
      />
    </div>

    <!-- Content column -->
    <div class="flex-1 min-w-0">

      <!-- Header row: name + timestamp + hover actions -->
      <div v-if="showHeader" class="flex items-baseline gap-2 mb-0.5">
        <span class="font-bold text-white text-[15px]">{{ message.senderName }}</span>
        <span class="text-xs text-gray-500">{{ formattedTime }}</span>
        <!-- Send status indicators -->
        <span v-if="message.sendStatus === 'sending'" class="inline-flex items-center gap-1 text-xs text-gray-500">
          <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          sending
        </span>
        <span v-else-if="message.sendStatus === 'queued'" class="inline-flex items-center gap-1 text-xs text-gray-500" title="Message queued — will send when connection is restored">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
          queued
        </span>
        <span v-else-if="message.sendStatus === 'failed'" class="inline-flex items-center gap-1 text-xs text-red-400">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Not sent
        </span>

        <!-- Hover actions (right-aligned) -->
        <div class="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <!-- 🙂 Add reaction: hide when reactions already exist -->
          <button
            v-if="!hasReactions && showThreadAction && !isThreadReply"
            ref="pickerToggleButton"
            class="h-7 w-7 rounded flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
            title="Add reaction"
            @click.stop="togglePickerButton"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
            </svg>
          </button>

          <!-- 💬 Reply in thread: hide when thread already has replies -->
          <button
            v-if="!threadReplyCount && showThreadAction && !isThreadReply"
            data-testid="new-thread-button"
            class="h-7 w-7 rounded flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
            title="Reply in thread"
            @click="$emit('openThread', message)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>

          <!-- ⋯ More actions -->
          <button
            ref="contextMenuTrigger"
            class="h-7 w-7 rounded flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
            title="More actions"
            @click.stop="toggleContextMenu"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Hover actions for grouped messages (no header row) -->
      <div v-if="!showHeader" class="absolute right-2 top-0.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          v-if="!hasReactions && showThreadAction && !isThreadReply"
          ref="pickerToggleButton"
          class="h-7 w-7 rounded flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
          title="Add reaction"
          @click.stop="togglePickerButton"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
          </svg>
        </button>
        <button
          v-if="!threadReplyCount && showThreadAction && !isThreadReply"
          data-testid="new-thread-button"
          class="h-7 w-7 rounded flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
          title="Reply in thread"
          @click="$emit('openThread', message)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <!-- ⋯ More actions -->
        <button
          ref="contextMenuTrigger"
          class="h-7 w-7 rounded flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
          title="More actions"
          @click.stop="toggleContextMenu"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
          </svg>
        </button>
      </div>

      <!-- Send status for grouped messages (no header row) -->
      <div v-if="!showHeader && message.sendStatus" class="mb-0.5 flex items-center gap-1">
        <span v-if="message.sendStatus === 'sending'" class="inline-flex items-center gap-1 text-xs text-gray-500">
          <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          sending
        </span>
        <span v-else-if="message.sendStatus === 'queued'" class="inline-flex items-center gap-1 text-xs text-gray-500" title="Message queued — will send when connection is restored">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
          queued
        </span>
        <span v-else-if="message.sendStatus === 'failed'" class="inline-flex items-center gap-1 text-xs text-red-400">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Not sent
        </span>
      </div>

      <!-- Message body -->
      <p
        v-if="message.body"
        class="text-[15px] leading-relaxed break-words whitespace-pre-wrap"
        :class="bodyTextClass"
      >{{ message.body }}</p>

      <!-- Failed message actions -->
      <div v-if="message.sendStatus === 'failed'" class="mt-1 flex items-center gap-2">
        <span v-if="message.failReason" class="text-xs text-red-400/80">{{ message.failReason }}</span>
        <button
          class="text-xs text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
          @click="handleRetry"
        >Retry</button>
        <button
          class="text-xs text-gray-500 hover:text-gray-400 hover:underline transition-colors"
          @click="handleDiscard"
        >Delete</button>
      </div>

      <div v-if="messageAttachments.length > 0" class="mt-2 space-y-2">
        <div
          v-for="attachment in messageAttachments"
          :key="attachment.id"
          class="rounded-md border border-chat-border bg-chat-input/70 p-2"
        >
          <div class="mb-1 flex items-center justify-between gap-2">
            <p class="truncate text-xs text-gray-300">{{ attachment.fileName }}</p>
            <button
              class="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
              title="Download"
              @click="downloadAttachment(attachment)"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>

          <button
            v-if="isImageAttachment(attachment)"
            class="block w-full overflow-hidden rounded border border-chat-border/70 bg-black/30"
            @click="openImagePreview(attachment)"
          >
            <img
              v-if="attachmentUrl(attachment)"
              :src="attachmentUrl(attachment)"
              :alt="attachment.fileName"
              class="max-h-72 w-full object-cover"
            >
            <div v-else class="flex h-24 items-center justify-center text-xs text-gray-500">
              {{ loadingAttachmentIds.has(attachment.id) ? 'Loading image...' : 'Preview unavailable' }}
            </div>
          </button>

          <div v-else-if="isVideoAttachment(attachment)">
            <video
              v-if="attachmentUrl(attachment)"
              class="w-full rounded border border-chat-border/70 bg-black/50"
              controls
              preload="metadata"
              :src="attachmentUrl(attachment)"
            />
            <p v-else class="text-[11px] text-gray-500">
              {{ loadingAttachmentIds.has(attachment.id) ? 'Loading video...' : 'Preview unavailable' }}
            </p>
          </div>

          <div v-else-if="isAudioAttachment(attachment)">
            <audio
              v-if="attachmentUrl(attachment)"
              class="w-full"
              controls
              preload="metadata"
              :src="attachmentUrl(attachment)"
            />
            <p v-else class="text-[11px] text-gray-500">
              {{ loadingAttachmentIds.has(attachment.id) ? 'Loading audio...' : 'Preview unavailable' }}
            </p>
          </div>

          <p v-else class="text-[11px] text-gray-500">
            {{ formatFileSize(attachment.fileSize) }}
          </p>
        </div>
      </div>

      <!-- Thread indicator (Section 4) -->
      <button
        v-if="threadReplyCount > 0 && showThreadAction && !isThreadReply"
        data-testid="thread-action-button"
        class="mt-1.5 flex items-center gap-2 text-[13px] text-cyan-300 hover:text-cyan-200 hover:underline transition-colors"
        @click="$emit('openThread', message)"
      >
        <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="font-medium">{{ threadReplyCount }} {{ threadReplyCount === 1 ? 'reply' : 'replies' }}</span>
        <span v-if="lastReplyAtLabel" class="text-gray-500 font-normal">Last reply {{ lastReplyAtLabel }}</span>
      </button>

      <!-- Reactions row (Section 3) -->
      <div v-if="hasReactions" class="mt-1.5 flex flex-wrap items-center gap-1">
        <button
          v-for="r in message.reactions"
          :key="r.emoji"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors"
          :class="reactionChipClass(r.emoji)"
          :title="`${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}`"
          :disabled="chat.isReactionOpPending(message.channelId, message.id, r.emoji)"
          @click="toggleReaction(r.emoji)"
        >
          <span>{{ r.emoji }}</span>
          <span class="font-medium">{{ r.count }}</span>
        </button>

        <!-- Add reaction button (visible when reactions exist) -->
        <div ref="pickerRoot" class="relative inline-flex">
          <button
            ref="pickerToggleButton"
            class="inline-flex items-center justify-center w-7 h-6 rounded-full text-xs border border-white/10 bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
            title="Add reaction"
            @click.stop="togglePickerButton"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
            </svg>
          </button>

          <!-- Emoji picker (anchored here when reactions exist) -->
          <div v-if="showEmojiPicker && hasReactions" class="absolute bottom-8 left-0 z-20">
            <component
              :is="pickerComponent"
              v-if="pickerComponent && emojiIndex"
              :data="emojiIndex"
              :native="true"
              set="native"
              title="Add reaction"
              emoji="slightly_smiling_face"
              :show-preview="false"
              :show-skin-tones="false"
              :infinite-scroll="false"
              :emoji-size="20"
              :per-line="9"
              color="#2f81f7"
              @select="onSelectEmoji"
              @selected="onSelectEmoji"
            />
            <div
              v-else
              class="rounded-md border border-white/10 bg-sidebar-bg px-3 py-2 text-xs text-gray-400 shadow-xl"
            >
              Loading emoji...
            </div>
          </div>
        </div>
      </div>

      <!-- Emoji picker (anchored to hover action button when no reactions) -->
      <div
        v-if="showEmojiPicker && !hasReactions"
        ref="pickerRoot"
        class="absolute right-2 top-8 z-20"
      >
        <component
          :is="pickerComponent"
          v-if="pickerComponent && emojiIndex"
          :data="emojiIndex"
          :native="true"
          set="native"
          title="Add reaction"
          emoji="slightly_smiling_face"
          :show-preview="false"
          :show-skin-tones="false"
          :infinite-scroll="false"
          :emoji-size="20"
          :per-line="9"
          color="#2f81f7"
          @select="onSelectEmoji"
          @selected="onSelectEmoji"
        />
        <div
          v-else
          class="rounded-md border border-white/10 bg-sidebar-bg px-3 py-2 text-xs text-gray-400 shadow-xl"
        >
          Loading emoji...
        </div>
      </div>

    </div>
  </div>

  <!-- Context menu — teleported to <body> to escape all overflow/clip contexts -->
  <Teleport to="body">
    <div
      v-if="showContextMenu"
      class="fixed z-[9999] min-w-[160px] rounded border border-white/10 bg-sidebar-bg shadow-xl py-1"
      :style="contextMenuStyle"
      @click.stop
    >
      <button
        class="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10 transition-colors"
        @click="copyMessage"
      >
        Copy message
      </button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="imagePreview.open"
      class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-4"
      @click.self="closeImagePreview"
    >
      <button
        class="absolute right-4 top-4 rounded bg-black/40 p-2 text-white hover:bg-black/70"
        @click="closeImagePreview"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <img
        v-if="imagePreview.src"
        :src="imagePreview.src"
        :alt="imagePreview.fileName"
        class="max-h-[85vh] max-w-[90vw] rounded border border-white/20 object-contain"
      >
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, shallowRef } from 'vue'
import type { Message, MessageAttachment } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'
import { useChatStore } from '@/stores/chat'
import { generateId } from '@/services/id'
import { fetchMessageAttachmentBlob } from '@/services/http/chatApi'
import UserAvatar from './UserAvatar.vue'

const props = withDefaults(defineProps<{
  message: Message
  showHeader: boolean
  threadReplyCount?: number
  showThreadAction?: boolean
  isActiveThread?: boolean
}>(), {
  threadReplyCount: 0,
  showThreadAction: true,
  isActiveThread: false,
})

defineEmits<{
  openThread: [message: Message]
}>()

const showEmojiPicker = ref(false)
const showContextMenu = ref(false)
const contextMenuStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })
const pickerRoot = ref<HTMLElement | null>(null)
const pickerToggleButton = ref<HTMLElement | null>(null)
const contextMenuTrigger = ref<HTMLElement | null>(null)
const pickerComponent = shallowRef<any>(null)
const emojiIndex = shallowRef<any>(null)
const emojiPickerLoading = ref(false)
const attachmentUrls = ref<Record<string, string>>({})
const loadingAttachmentIds = ref(new Set<string>())
const imagePreview = ref<{ open: boolean; src: string; fileName: string }>({
  open: false,
  src: '',
  fileName: '',
})
const ws = useWsStore()
const chat = useChatStore()
const DEBUG_REACTIONS = false

function debugReaction(label: string, payload?: unknown) {
  if (!DEBUG_REACTIONS) return
  if (typeof payload === 'undefined') {
    console.debug(`[reactions] ${label}`)
    return
  }
  console.debug(`[reactions] ${label}`, payload)
}

const formattedTime = computed(() => {
  const d = new Date(props.message.createdAt)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

const hasReactions = computed(() => props.message.reactions.length > 0)

const isThreadReply = computed(() => {
  const rootId = props.message.threadRootMessageId
  return Boolean(rootId && rootId !== props.message.id)
})

const showThreadAction = computed(() => props.showThreadAction && !isThreadReply.value)
const messageAttachments = computed(() => props.message.attachments ?? [])

const lastReplyAtLabel = computed(() => {
  const summary = chat.threadSummaries[props.message.id]
  if (!summary?.lastReplyAt) return null
  return relativeTime(summary.lastReplyAt)
})

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d ago`
}

const bodyTextClass = computed(() => {
  switch (props.message.sendStatus) {
    case 'sending': return 'text-gray-100 opacity-90'
    case 'queued': return 'text-gray-100 opacity-80'
    case 'failed': return 'text-gray-300 opacity-75'
    default: return props.message.pending ? 'text-gray-400' : 'text-gray-100'
  }
})

const bubbleStyle = computed(() =>
  showEmojiPicker.value
    ? undefined
    : ({ contentVisibility: 'auto', containIntrinsicSize: '72px' } as const)
)

// ── Send status actions ──────────────────────────────────────────────────────

function handleRetry() {
  const msg = props.message
  if (!msg.clientMsgId || msg.sendStatus !== 'failed') return
  const isThread = Boolean(msg.threadRootMessageId && msg.threadRootMessageId !== msg.id)
  if (isThread && msg.threadRootMessageId) {
    chat.retryThreadMessage(msg.threadRootMessageId, msg.clientMsgId)
  } else {
    chat.retryMessage(msg.channelId, msg.clientMsgId)
  }
}

function handleDiscard() {
  const msg = props.message
  if (!msg.clientMsgId || msg.sendStatus !== 'failed') return
  const isThread = Boolean(msg.threadRootMessageId && msg.threadRootMessageId !== msg.id)
  if (isThread && msg.threadRootMessageId) {
    chat.discardFailedThreadMessage(msg.threadRootMessageId, msg.clientMsgId)
  } else {
    chat.discardFailedMessage(msg.channelId, msg.clientMsgId)
  }
}

// ── Attachments ───────────────────────────────────────────────────────────────

function isImageAttachment(attachment: MessageAttachment): boolean {
  return attachment.mimeType.startsWith('image/')
}

function isVideoAttachment(attachment: MessageAttachment): boolean {
  return attachment.mimeType.startsWith('video/')
}

function isAudioAttachment(attachment: MessageAttachment): boolean {
  return attachment.mimeType.startsWith('audio/')
}

function attachmentUrl(attachment: MessageAttachment): string {
  return attachmentUrls.value[attachment.id] ?? ''
}

function revokeAttachmentUrl(attachmentId: string) {
  const url = attachmentUrls.value[attachmentId]
  if (!url) return
  URL.revokeObjectURL(url)
  delete attachmentUrls.value[attachmentId]
}

function syncAttachmentUrls() {
  const currentIds = new Set(messageAttachments.value.map(item => item.id))
  for (const id of Object.keys(attachmentUrls.value)) {
    if (!currentIds.has(id)) {
      revokeAttachmentUrl(id)
    }
  }
}

async function ensureAttachmentUrl(attachment: MessageAttachment) {
  if (attachmentUrls.value[attachment.id]) return
  if (loadingAttachmentIds.value.has(attachment.id)) return
  if (props.message.sendStatus || props.message.pending) return
  loadingAttachmentIds.value.add(attachment.id)
  try {
    const blob = await fetchMessageAttachmentBlob(props.message.id, attachment.id)
    attachmentUrls.value = {
      ...attachmentUrls.value,
      [attachment.id]: URL.createObjectURL(blob),
    }
  } catch (error) {
    console.debug('[attachments] preview load failed', { messageId: props.message.id, attachmentId: attachment.id, error })
  } finally {
    loadingAttachmentIds.value.delete(attachment.id)
  }
}

function preloadAttachmentUrls() {
  for (const attachment of messageAttachments.value) {
    if (isImageAttachment(attachment) || isVideoAttachment(attachment) || isAudioAttachment(attachment)) {
      void ensureAttachmentUrl(attachment)
    }
  }
}

async function downloadAttachment(attachment: MessageAttachment) {
  try {
    const blob = await fetchMessageAttachmentBlob(props.message.id, attachment.id)
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = attachment.fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  } catch (error) {
    console.debug('[attachments] download failed', { messageId: props.message.id, attachmentId: attachment.id, error })
  }
}

function openImagePreview(attachment: MessageAttachment) {
  const src = attachmentUrl(attachment)
  if (!src) return
  imagePreview.value = {
    open: true,
    src,
    fileName: attachment.fileName,
  }
}

function closeImagePreview() {
  imagePreview.value = {
    open: false,
    src: '',
    fileName: '',
  }
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

// ── Reactions ────────────────────────────────────────────────────────────────

function toggleReaction(emoji: string) {
  debugReaction('toggleReaction:clicked', {
    emoji,
    channelId: props.message.channelId,
    messageId: props.message.id,
    mine: props.message.myReactions.includes(emoji),
  })
  if (!props.message.channelId) return
  if (chat.isReactionOpPending(props.message.channelId, props.message.id, emoji)) return
  const mine = props.message.myReactions.includes(emoji)
  const opId = generateId()
  if (mine) {
    debugReaction('toggleReaction:remove', { opId, emoji })
    chat.queueReactionOp(opId, props.message.channelId, props.message.id, emoji, 'remove')
    ws.sendRemoveReaction(props.message.channelId, props.message.id, emoji, opId)
  } else {
    debugReaction('toggleReaction:add', { opId, emoji })
    chat.queueReactionOp(opId, props.message.channelId, props.message.id, emoji, 'add')
    ws.sendAddReaction(props.message.channelId, props.message.id, emoji, opId)
  }
}

function addReaction(emoji: string) {
  debugReaction('addReaction:entered', {
    emoji,
    channelId: props.message.channelId,
    messageId: props.message.id,
    alreadyMine: props.message.myReactions.includes(emoji),
  })
  showEmojiPicker.value = false
  if (!props.message.channelId) return
  if (props.message.myReactions.includes(emoji)) return
  if (chat.isReactionOpPending(props.message.channelId, props.message.id, emoji)) return
  const opId = generateId()
  debugReaction('addReaction:queue+send', { opId, emoji })
  chat.queueReactionOp(opId, props.message.channelId, props.message.id, emoji, 'add')
  ws.sendAddReaction(props.message.channelId, props.message.id, emoji, opId)
}

function onSelectEmoji(emoji: { native?: string; colons?: string; id?: string }) {
  debugReaction('picker:select:event', emoji)
  const value = emoji.native ?? emoji.colons ?? emoji.id
  debugReaction('picker:select:resolved', { value })
  if (!value) return
  addReaction(value)
}

// ── Emoji picker ─────────────────────────────────────────────────────────────

function togglePickerButton() {
  showEmojiPicker.value = !showEmojiPicker.value
  if (showEmojiPicker.value) {
    void ensureEmojiPickerLoaded()
  }
  debugReaction('picker:toggle', { visible: showEmojiPicker.value })
}

async function ensureEmojiPickerLoaded() {
  if (pickerComponent.value && emojiIndex.value) return
  if (emojiPickerLoading.value) return
  emojiPickerLoading.value = true
  try {
    const [pickerModule, emojiDataModule] = await Promise.all([
      import('emoji-mart-vue-fast/src'),
      import('emoji-mart-vue-fast/data/all.json'),
    ])
    const data = (emojiDataModule as any).default ?? emojiDataModule
    pickerComponent.value = pickerModule.Picker
    emojiIndex.value = new pickerModule.EmojiIndex(data)
    debugReaction('picker:loaded')
  } catch (error) {
    console.error('[reactions] picker:load-failed', error)
    showEmojiPicker.value = false
  } finally {
    emojiPickerLoading.value = false
  }
}

function handleDocumentClick(evt: MouseEvent) {
  const target = evt.target as Node
  // Close emoji picker
  if (showEmojiPicker.value) {
    if (pickerToggleButton.value?.contains(target)) return
    if (pickerRoot.value?.contains(target)) return
    showEmojiPicker.value = false
    debugReaction('picker:outside-close')
  }
  // Close context menu — allow clicks inside the teleported menu itself
  if (showContextMenu.value) {
    showContextMenu.value = false
  }
}

function handleEscape(evt: KeyboardEvent) {
  if (evt.key !== 'Escape') return
  showEmojiPicker.value = false
  showContextMenu.value = false
  debugReaction('picker:escape-close')
}

watch([showEmojiPicker, showContextMenu], ([pickerVisible, menuVisible]) => {
  const anyOpen = pickerVisible || menuVisible
  if (anyOpen) {
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleEscape)
  } else {
    document.removeEventListener('click', handleDocumentClick)
    document.removeEventListener('keydown', handleEscape)
  }
})

watch(messageAttachments, () => {
  syncAttachmentUrls()
  preloadAttachmentUrls()
}, { immediate: true, deep: true })

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleEscape)
  closeImagePreview()
  for (const id of Object.keys(attachmentUrls.value)) {
    revokeAttachmentUrl(id)
  }
})

// ── Context menu ─────────────────────────────────────────────────────────────

function toggleContextMenu() {
  if (showContextMenu.value) {
    showContextMenu.value = false
    return
  }
  // Calculate position from trigger button before showing
  const trigger = contextMenuTrigger.value
  if (trigger) {
    const rect = trigger.getBoundingClientRect()
    // Align right edge of menu with right edge of trigger; appear below
    const menuWidth = 160
    contextMenuStyle.value = {
      top: `${rect.bottom + 4}px`,
      left: `${rect.right - menuWidth}px`,
    }
  }
  showContextMenu.value = true
  showEmojiPicker.value = false
}

function copyMessage() {
  showContextMenu.value = false
  void navigator.clipboard.writeText(props.message.body)
}

// ── Reaction chip styles ─────────────────────────────────────────────────────

function reactionChipClass(emoji: string): string {
  const mine = props.message.myReactions.includes(emoji)
  const pending = chat.isReactionOpPending(props.message.channelId, props.message.id, emoji)
  if (mine) {
    return pending
      ? 'border-accent/40 bg-accent/20 text-white opacity-70'
      : 'border-accent/60 bg-accent/25 text-white'
  }
  return pending
    ? 'border-white/10 bg-white/5 text-gray-300 opacity-70'
    : 'border-white/10 bg-white/5 hover:bg-white/10 text-gray-300'
}
</script>
