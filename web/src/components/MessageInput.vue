<template>
  <div class="shrink-0 px-4 pb-4 pt-2">
    <div v-if="attachments.length > 0" class="mb-2 rounded-lg border border-chat-border bg-chat-input/70 p-2">
      <p class="mb-1 text-[11px] text-gray-500">Attachments ({{ attachments.length }}/{{ MAX_ATTACHMENTS }})</p>
      <ul class="space-y-1">
        <li
          v-for="attachment in attachments"
          :key="attachment.id"
          class="flex items-center justify-between gap-2 rounded border border-chat-border bg-chat-input px-2 py-1"
        >
          <div class="min-w-0">
            <p class="truncate text-xs text-gray-200">{{ attachment.fileName }}</p>
            <p class="text-[11px] text-gray-500">{{ formatFileSize(attachment.fileSize) }}</p>
          </div>
          <button
            class="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
            title="Remove attachment"
            :disabled="removingAttachmentIds.has(attachment.id)"
            @click="removeAttachment(attachment.id)"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </li>
      </ul>
    </div>

    <div
      class="flex items-end gap-2 rounded-lg border px-3 py-2 transition-colors"
      :class="isDragOver ? 'border-accent bg-chat-input/90' : 'border-chat-border bg-chat-input'"
    >
      <input
        ref="fileInputEl"
        type="file"
        class="hidden"
        multiple
        @change="onFileInputChange"
      >
      <button
        class="text-gray-400 hover:text-gray-200 transition-colors shrink-0 mb-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="disabled || uploading || !conversationId || attachments.length >= MAX_ATTACHMENTS"
        :title="attachButtonTitle"
        @click="openFilePicker"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </button>

      <!-- Text area -->
      <textarea
        ref="inputEl"
        v-model="text"
        class="flex-1 bg-transparent text-gray-100 placeholder-gray-500 text-[15px] resize-none outline-none leading-relaxed max-h-40 min-h-[24px]"
        :placeholder="`Message #${channelName}`"
        :disabled="disabled"
        rows="1"
        @keydown.enter.exact.prevent="submit"
        @keydown.enter.shift.exact="addNewline"
        @input="autoResize"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
      />

      <!-- Send button -->
      <button
        class="shrink-0 mb-0.5 p-1.5 rounded transition-colors"
        :class="canSend
          ? 'bg-accent hover:bg-accent-hover text-white'
          : 'text-gray-600 cursor-not-allowed'"
        :disabled="!canSend"
        @click="submit"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/>
        </svg>
      </button>
    </div>
    <p class="mt-1 flex items-center justify-between gap-2 text-xs text-gray-600 pl-1">
      <span class="truncate text-gray-500">{{ typingLabel || '' }}</span>
      <span class="whitespace-nowrap">
        <kbd class="font-mono">Enter</kbd> to send · <kbd class="font-mono">Shift+Enter</kbd> for new line
      </span>
    </p>
    <p v-if="uploading" class="mt-1 pl-1 text-[11px] text-gray-500">Uploading attachments...</p>
    <p v-else-if="attachmentWarning" class="mt-1 pl-1 text-[11px] text-amber-300">{{ attachmentWarning }}</p>
    <p v-else-if="attachmentError" class="mt-1 pl-1 text-[11px] text-red-400">{{ attachmentError }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { uploadChatAttachment, deleteChatAttachment } from '@/services/http/chatApi'

interface ComposerAttachment {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
}

interface ComposerSendPayload {
  body: string
  attachmentIds: string[]
  attachments: ComposerAttachment[]
}

const MAX_ATTACHMENTS = 5
const props = defineProps<{
  channelName: string
  conversationId?: string
  disabled?: boolean
  typingLabel?: string
  online?: boolean
}>()
const emit = defineEmits<{ send: [payload: ComposerSendPayload]; typing: [active: boolean] }>()

const text = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const attachments = ref<ComposerAttachment[]>([])
const uploading = ref(false)
const attachmentError = ref('')
const removingAttachmentIds = ref(new Set<string>())
const isDragOver = ref(false)
let dragDepth = 0

const attachmentWarning = computed(() => {
  if (attachments.value.length > 0 && props.online === false) {
    return 'Reconnect to send attachments'
  }
  return ''
})

const canSend = computed(() => {
  if (props.disabled || uploading.value) return false
  if (!text.value.trim() && attachments.value.length === 0) return false
  if (attachments.value.length > 0 && props.online === false) return false
  return true
})

const attachButtonTitle = computed(() => {
  if (!props.conversationId) return 'Open a conversation to attach files'
  if (attachments.value.length >= MAX_ATTACHMENTS) return `Max ${MAX_ATTACHMENTS} attachments per message`
  return 'Attach file'
})

function submit() {
  if (!canSend.value) return
  const body = text.value.trim()
  emit('send', {
    body,
    attachmentIds: attachments.value.map(item => item.id),
    attachments: attachments.value.slice(),
  })
  text.value = ''
  attachments.value = []
  attachmentError.value = ''
  emitTyping(false)
  nextTick(() => {
    if (inputEl.value) {
      inputEl.value.style.height = 'auto'
    }
  })
}

function addNewline() {
  text.value += '\n'
  nextTick(() => autoResize())
}

function autoResize() {
  const el = inputEl.value
  if (!el) return
  emitTyping(text.value.trim().length > 0)
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

function emitTyping(active: boolean) {
  if (props.disabled) return
  emit('typing', active)
}

function openFilePicker() {
  fileInputEl.value?.click()
}

async function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  target.value = ''
  if (files.length === 0) return
  await uploadFiles(files)
}

async function uploadFiles(files: File[]) {
  if (!props.conversationId) return
  if (props.disabled || uploading.value) return
  attachmentError.value = ''
  const remainingSlots = MAX_ATTACHMENTS - attachments.value.length
  if (remainingSlots <= 0) {
    attachmentError.value = `Max ${MAX_ATTACHMENTS} attachments per message`
    return
  }
  const selected = files.slice(0, remainingSlots)
  if (selected.length < files.length) {
    attachmentError.value = `Only ${MAX_ATTACHMENTS} attachments are allowed per message`
  }

  uploading.value = true
  try {
    for (const file of selected) {
      const uploaded = await uploadChatAttachment(props.conversationId, file)
      attachments.value.push({
        id: uploaded.id,
        fileName: uploaded.file_name,
        fileSize: uploaded.file_size,
        mimeType: uploaded.mime_type,
      })
    }
  } catch (error) {
    attachmentError.value = error instanceof Error ? error.message : 'Failed to upload attachment'
  } finally {
    uploading.value = false
  }
}

function isFileDragEvent(event: DragEvent): boolean {
  return event.dataTransfer?.types?.includes('Files') ?? false
}

function onDragEnter(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  if (!props.conversationId || props.disabled || uploading.value) return
  dragDepth += 1
  isDragOver.value = true
}

function onDragOver(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  if (!props.conversationId || props.disabled || uploading.value) return
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isDragOver.value = true
}

function onDragLeave(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) {
    isDragOver.value = false
  }
}

async function onDrop(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  const files = Array.from(event.dataTransfer?.files ?? [])
  dragDepth = 0
  isDragOver.value = false
  if (files.length === 0) return
  await uploadFiles(files)
}

async function removeAttachment(attachmentId: string) {
  removingAttachmentIds.value.add(attachmentId)
  attachmentError.value = ''
  try {
    await deleteChatAttachment(attachmentId)
    attachments.value = attachments.value.filter(item => item.id !== attachmentId)
  } catch (error) {
    attachmentError.value = error instanceof Error ? error.message : 'Failed to remove attachment'
  } finally {
    removingAttachmentIds.value.delete(attachmentId)
  }
}

async function cleanupStagedAttachments() {
  const stagedIds = attachments.value.map(item => item.id)
  attachments.value = []
  await Promise.allSettled(stagedIds.map(async id => {
    try {
      await deleteChatAttachment(id)
    } catch {
      // Best-effort cleanup only.
    }
  }))
}

watch(() => props.conversationId, (next, prev) => {
  if (prev && prev !== next && attachments.value.length > 0) {
    void cleanupStagedAttachments()
  }
})

onBeforeUnmount(() => {
  if (attachments.value.length > 0) {
    void cleanupStagedAttachments()
  }
})

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
</script>
