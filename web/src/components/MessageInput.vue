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
      class="flex flex-col gap-2 rounded-lg border px-3 py-2 transition-colors"
      :class="isDragOver ? 'border-accent bg-chat-input/90' : 'border-chat-border bg-chat-input'"
    >
      <input
        ref="fileInputEl"
        type="file"
        class="hidden"
        multiple
        @change="onFileInputChange"
      >

      <!-- Text area -->
      <textarea
        ref="inputEl"
        v-model="text"
        class="bg-transparent text-gray-100 placeholder-gray-500 resize-none outline-none leading-relaxed min-h-[24px]"
        :placeholder="`Message #${channelName}`"
        :disabled="disabled"
        rows="1"
        @keydown.enter.exact.prevent="submit"
        @keydown.shift.enter.exact.prevent.stop="onShiftEnter"
        @keydown="handleTextareaKeydown"
        @click="captureSelectionAndRefreshTagSearch"
        @keyup="captureSelectionAndRefreshTagSearch"
        @input="handleTextareaInput"
        @paste="onPaste"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
      />

      <div data-testid="composer-controls-row" class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button
            data-testid="composer-attach-button"
            class="shrink-0 text-gray-400 transition-colors hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="disabled || uploading || !conversationId || attachments.length >= MAX_ATTACHMENTS"
            :title="attachButtonTitle"
            @click="openFilePicker"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>

          <button
            ref="pickerToggleButton"
            data-testid="composer-emoji-button"
            class="shrink-0 text-gray-400 transition-colors hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="disabled"
            title="Add emoji"
            @click.stop="toggleEmojiPicker"
          >
            <span class="text-lg leading-none">🙂</span>
          </button>
        </div>

        <button
          data-testid="composer-send-button"
          class="shrink-0 rounded p-1.5 transition-colors"
          :class="canSend
            ? 'bg-accent hover:bg-accent-hover text-white'
            : 'text-gray-600 cursor-not-allowed'"
          :disabled="!canSend"
          @click="submit"
        >
          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/>
          </svg>
        </button>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="showEmojiPicker"
        ref="pickerRoot"
        class="z-20 emoji-picker-dark"
        :style="emojiPickerStyle"
        @click.stop
      >
        <component
          :is="pickerComponent"
          v-if="pickerComponent && emojiIndex"
          :data="emojiIndex"
          :native="true"
          set="apple"
          title="Add emoji"
          emoji="slightly_smiling_face"
          :show-preview="true"
          :show-skin-tones="false"
          :infinite-scroll="true"
          :emoji-size="26"
          :per-line="9"
          color="#ae65c5"
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
    </Teleport>
    <p class="mt-1 flex items-center justify-between gap-2 text-xs text-gray-600 pl-1">
      <span class="truncate text-gray-500">{{ typingLabel || '' }}</span>
      <span class="whitespace-nowrap">
        <kbd class="font-mono">Enter</kbd> to send · <kbd class="font-mono">Shift+Enter</kbd> for new line
      </span>
    </p>
    <div v-if="uploading" class="mt-1 pl-1">
      <div class="mb-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
        <span class="truncate">
          Uploading{{ currentUploadingFileName ? ` ${currentUploadingFileName}` : ' attachments' }}...
        </span>
        <span class="tabular-nums">{{ uploadProgressPercent }}%</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded bg-white/10">
        <div
          class="h-full bg-accent transition-[width] duration-150"
          :style="{ width: `${uploadProgressPercent}%` }"
        />
      </div>
    </div>
    <p v-else-if="attachmentWarning" class="mt-1 pl-1 text-[11px] text-amber-300">{{ attachmentWarning }}</p>
    <p v-else-if="attachmentError" class="mt-1 pl-1 text-[11px] text-red-400">{{ attachmentError }}</p>
    <MessageTagPicker
      :open="tagPickerOpen"
      :loading="tagPickerLoading"
      :error="tagPickerError"
      :style="tagPickerStyle"
      :selected-index="selectedTagIndex"
      :users="tagPickerUsers"
      :tasks="tagPickerTasks"
      :documents="tagPickerDocuments"
      @select="selectTagItem"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { uploadChatAttachment, deleteChatAttachment, searchTagEntities, type TagSearchResponse } from '@/services/http/chatApi'
import { useComposerEmojiPicker } from '@/composables/useComposerEmojiPicker'
import type { MessageEntity } from '@/stores/chat'
import MessageTagPicker, { type MessageTagPickerItem } from './MessageTagPicker.vue'
import {
  applyTextEditToEntities,
  findMentionQuery,
  removeEntityAroundCursor,
  replaceTextRangeWithEntity,
} from '@/utils/messageEntities'

interface ComposerAttachment {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
}

interface ComposerSendPayload {
  body: string
  entities: MessageEntity[]
  attachmentIds: string[]
  attachments: ComposerAttachment[]
}

const MAX_ATTACHMENTS = 5
const MAX_TEXTAREA_LINES = 8
const DEBUG_COMPOSER_AUTOGROW = import.meta.env.DEV
const props = defineProps<{
  channelName: string
  conversationId?: string
  disabled?: boolean
  typingLabel?: string
  online?: boolean
}>()
const emit = defineEmits<{
  send: [payload: ComposerSendPayload]
  typing: [active: boolean]
  resize: [deltaPx: number]
}>()

const text = ref('')
const entities = ref<MessageEntity[]>([])
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const attachments = ref<ComposerAttachment[]>([])
const uploading = ref(false)
const uploadProgressPercent = ref(0)
const currentUploadingFileName = ref('')
const attachmentError = ref('')
const removingAttachmentIds = ref(new Set<string>())
const isDragOver = ref(false)
let dragDepth = 0
let lastTextareaHeight = 0
let lastSelectionStart = 0
let lastSelectionEnd = 0
let lastTextSnapshot = ''
let searchRequestToken = 0
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const tagPickerOpen = ref(false)
const tagPickerLoading = ref(false)
const tagPickerError = ref('')
const tagPickerStyle = ref<Record<string, string>>({
  top: '0px',
  left: '0px',
})
const tagQueryRange = ref<{ start: number; end: number } | null>(null)
const tagSearchResults = ref<TagSearchResponse>({
  users: [],
  tasks: [],
  documents: [],
})
const selectedTagIndex = ref(0)

function logComposerAutogrow(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_COMPOSER_AUTOGROW) return
  console.debug(`[debug][composer-autogrow] ${event}`, payload)
}

const {
  showEmojiPicker,
  pickerRoot,
  pickerToggleButton,
  pickerComponent,
  emojiIndex,
  emojiPickerStyle,
  toggleEmojiPicker,
  closeEmojiPicker,
  onSelectEmoji,
} = useComposerEmojiPicker({
  onSelect: insertEmojiAtCursor,
})

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

const flatTagItems = computed(() => [
  ...tagPickerUsers.value,
  ...tagPickerTasks.value,
  ...tagPickerDocuments.value,
])

const tagPickerUsers = computed<MessageTagPickerItem[]>(() =>
  (tagSearchResults.value.users ?? []).map((item, index) => ({
    kind: 'user',
    id: item.user_id,
    label: `@${item.display_name || item.email}`,
    subtitle: item.email,
    href: '',
    icon: '@',
    flatIndex: index,
    meta: {
      email: item.email,
      presence: item.presence,
    },
  })),
)

const tagPickerTasks = computed<MessageTagPickerItem[]>(() =>
  (tagSearchResults.value.tasks ?? []).map((item, index) => ({
    kind: 'task',
    id: item.task_id,
    label: item.label,
    subtitle: item.title,
    href: item.href,
    icon: '#',
    flatIndex: tagPickerUsers.value.length + index,
  })),
)

const tagPickerDocuments = computed<MessageTagPickerItem[]>(() =>
  (tagSearchResults.value.documents ?? []).map((item, index) => ({
    kind: 'document',
    id: item.document_id,
    label: item.label,
    subtitle: item.title,
    href: item.href,
    icon: 'D',
    flatIndex: tagPickerUsers.value.length + tagPickerTasks.value.length + index,
  })),
)

function submit() {
  if (!canSend.value) return
  const body = text.value.trim()
  const trimmedDelta = text.value.length - text.value.trimStart().length
  const nextEntities = entities.value
    .map(entity => ({
      ...entity,
      start: entity.start - trimmedDelta,
      end: entity.end - trimmedDelta,
    }))
    .filter(entity => entity.start >= 0 && entity.end <= body.length)
  emit('send', {
    body,
    entities: nextEntities,
    attachmentIds: attachments.value.map(item => item.id),
    attachments: attachments.value.slice(),
  })
  text.value = ''
  entities.value = []
  attachments.value = []
  attachmentError.value = ''
  closeTagPicker()
  closeEmojiPicker()
  emitTyping(false)
  nextTick(() => {
    resizeTextarea()
  })
}

function insertEmojiAtCursor(emoji: string) {
  const el = inputEl.value
  if (!el) {
    text.value += emoji
    nextTick(() => autoResize())
    return
  }

  const start = el.selectionStart ?? text.value.length
  const end = el.selectionEnd ?? start
  text.value = `${text.value.slice(0, start)}${emoji}${text.value.slice(end)}`
  entities.value = applyTextEditToEntities(entities.value, start, end, emoji.length)

  nextTick(() => {
    const cursor = start + emoji.length
    el.focus()
    el.selectionStart = cursor
    el.selectionEnd = cursor
    autoResize()
  })
}

function onShiftEnter(event: KeyboardEvent) {
  const el = event.target as HTMLTextAreaElement
  const start = el.selectionStart ?? text.value.length
  const end = el.selectionEnd ?? start
  text.value = text.value.slice(0, start) + '\n' + text.value.slice(end)
  entities.value = applyTextEditToEntities(entities.value, start, end, 1)
  nextTick(() => {
    const cursor = start + 1
    el.selectionStart = cursor
    el.selectionEnd = cursor
    autoResize()
  })
}

function closeTagPicker() {
  tagPickerOpen.value = false
  tagPickerLoading.value = false
  tagPickerError.value = ''
  tagQueryRange.value = null
  selectedTagIndex.value = 0
}

function updateTagPickerPosition() {
  const el = inputEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  tagPickerStyle.value = {
    position: 'fixed',
    top: `${rect.top - 8}px`,
    left: `${rect.left}px`,
    transform: 'translateY(-100%)',
  }
}

function captureSelection() {
  const el = inputEl.value
  if (!el) return
  lastSelectionStart = el.selectionStart ?? text.value.length
  lastSelectionEnd = el.selectionEnd ?? lastSelectionStart
  lastTextSnapshot = text.value
}

function refreshTagSearch() {
  const el = inputEl.value
  if (!el || !props.conversationId) {
    closeTagPicker()
    return
  }
  if ((el.selectionStart ?? 0) !== (el.selectionEnd ?? 0)) {
    closeTagPicker()
    return
  }

  const cursor = el.selectionStart ?? text.value.length
  const match = findMentionQuery(text.value, cursor, entities.value)
  if (!match) {
    closeTagPicker()
    return
  }

  tagQueryRange.value = { start: match.start, end: match.end }
  tagPickerOpen.value = true
  updateTagPickerPosition()
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(async () => {
    const token = ++searchRequestToken
    tagPickerLoading.value = true
    tagPickerError.value = ''
    try {
      const results = await searchTagEntities(props.conversationId!, match.query)
      if (token !== searchRequestToken) return
      tagSearchResults.value = results
      selectedTagIndex.value = 0
    } catch (error) {
      if (token !== searchRequestToken) return
      tagPickerError.value = error instanceof Error ? error.message : 'Search failed'
      tagSearchResults.value = { users: [], tasks: [], documents: [] }
    } finally {
      if (token === searchRequestToken) {
        tagPickerLoading.value = false
      }
    }
  }, 120)
}

function captureSelectionAndRefreshTagSearch() {
  captureSelection()
  refreshTagSearch()
}

function selectTagItem(item: MessageTagPickerItem) {
  if (!tagQueryRange.value) return
  const next = replaceTextRangeWithEntity(
    text.value,
    entities.value,
    tagQueryRange.value.start,
    tagQueryRange.value.end,
    {
      kind: item.kind,
      targetId: item.id,
      label: item.label,
      href: item.href,
      start: tagQueryRange.value.start,
      end: tagQueryRange.value.end,
    },
  )
  text.value = next.text
  entities.value = next.entities
  closeTagPicker()
  nextTick(() => {
    const el = inputEl.value
    if (!el) return
    el.focus()
    el.selectionStart = next.nextCursor
    el.selectionEnd = next.nextCursor
    captureSelection()
    autoResize()
  })
}

function handleTextareaKeydown(event: KeyboardEvent) {
  captureSelection()
  if (tagPickerOpen.value && flatTagItems.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      selectedTagIndex.value = (selectedTagIndex.value + 1) % flatTagItems.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      selectedTagIndex.value = (selectedTagIndex.value - 1 + flatTagItems.value.length) % flatTagItems.value.length
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const item = flatTagItems.value[selectedTagIndex.value]
      if (item) selectTagItem(item)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeTagPicker()
      return
    }
  }

  if (!inputEl.value) return
  if ((event.key === 'Backspace' || event.key === 'Delete') && inputEl.value.selectionStart === inputEl.value.selectionEnd) {
    const cursor = inputEl.value.selectionStart ?? 0
    const removed = removeEntityAroundCursor(
      text.value,
      entities.value,
      cursor,
      event.key === 'Backspace' ? 'backward' : 'forward',
    )
    if (removed) {
      event.preventDefault()
      text.value = removed.text
      entities.value = removed.entities
      nextTick(() => {
        const el = inputEl.value
        if (!el) return
        el.selectionStart = removed.nextCursor
        el.selectionEnd = removed.nextCursor
        captureSelectionAndRefreshTagSearch()
        autoResize()
      })
    }
  }
}

function handleTextareaInput() {
  const el = inputEl.value
  const currentSelectionStart = el?.selectionStart ?? text.value.length
  const replacedLength = lastSelectionEnd - lastSelectionStart
  const insertedLength = text.value.length - (lastTextSnapshot.length - replacedLength)
  entities.value = applyTextEditToEntities(
    entities.value,
    lastSelectionStart,
    lastSelectionEnd,
    insertedLength,
  ).filter(entity => text.value.slice(entity.start, entity.end) === entity.label)
  captureSelectionAndRefreshTagSearch()
  autoResize()
}

function autoResize() {
  emitTyping(text.value.trim().length > 0)
  resizeTextarea()
}

function resizeTextarea() {
  const el = inputEl.value
  if (!el) return
  const previousHeight = lastTextareaHeight
  const style = window.getComputedStyle(el)
  const fontSize = Number.parseFloat(style.fontSize) || 16
  const lineHeight = Number.parseFloat(style.lineHeight) || (fontSize * 1.5)
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
  const maxHeight = Math.ceil((lineHeight * MAX_TEXTAREA_LINES) + paddingTop + paddingBottom)

  el.style.maxHeight = `${maxHeight}px`
  el.style.height = '0px'
  const nextHeight = Math.min(el.scrollHeight, maxHeight)
  el.style.height = `${nextHeight}px`
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  lastTextareaHeight = nextHeight
  const delta = nextHeight - previousHeight
  logComposerAutogrow('resize', {
    conversationId: props.conversationId ?? '',
    previousHeight,
    nextHeight,
    delta,
    maxHeight,
    scrollHeight: el.scrollHeight,
    overflowY: el.style.overflowY,
    textLength: text.value.length,
  })
  if (previousHeight > 0 && previousHeight !== nextHeight) {
    emit('resize', delta)
  }
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
  uploadProgressPercent.value = 0
  currentUploadingFileName.value = ''
  try {
    const totalBytes = selected.reduce((sum, file) => sum + Math.max(0, file.size), 0)
    let uploadedBytes = 0
    for (const file of selected) {
      currentUploadingFileName.value = file.name
      const fileBytes = Math.max(0, file.size)
      const uploaded = await uploadChatAttachment(props.conversationId, file, (loaded, total) => {
        const effectiveTotal = Math.max(1, total || fileBytes || loaded)
        const clampedCurrent = Math.min(Math.max(0, loaded), effectiveTotal)
        const overallLoaded = uploadedBytes + clampedCurrent
        const overallTotal = Math.max(1, totalBytes || effectiveTotal)
        uploadProgressPercent.value = Math.min(100, Math.round((overallLoaded / overallTotal) * 100))
      })
      attachments.value.push({
        id: uploaded.id,
        fileName: uploaded.file_name,
        fileSize: uploaded.file_size,
        mimeType: uploaded.mime_type,
      })
      uploadedBytes += fileBytes
      const overallTotal = Math.max(1, totalBytes || uploadedBytes || 1)
      uploadProgressPercent.value = Math.min(100, Math.round((uploadedBytes / overallTotal) * 100))
    }
  } catch (error) {
    attachmentError.value = error instanceof Error ? error.message : 'Failed to upload attachment'
  } finally {
    currentUploadingFileName.value = ''
    uploadProgressPercent.value = 0
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

function clipboardFileKey(file: File): string {
  return `${file.name}:${file.size}:${file.type}:${file.lastModified}`
}

function extractClipboardFiles(event: ClipboardEvent): File[] {
  const data = event.clipboardData
  if (!data) return []

  const files: File[] = []
  const seen = new Set<string>()
  const pushFile = (file: File | null | undefined) => {
    if (!file) return
    const key = clipboardFileKey(file)
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }

  const itemFiles: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) itemFiles.push(file)
  }

  // Browsers may expose the same pasted image in both `items` and `files`.
  // Prefer `items` when available to avoid duplicate uploads from one paste.
  if (itemFiles.length > 0) {
    for (const file of itemFiles) pushFile(file)
    return files
  }

  for (const file of Array.from(data.files ?? [])) pushFile(file)
  return files
}

function onPaste(event: ClipboardEvent) {
  const files = extractClipboardFiles(event)
  if (files.length === 0) return
  if (!props.conversationId || props.disabled || uploading.value) return

  event.preventDefault()
  void uploadFiles(files)
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
  closeEmojiPicker()
  closeTagPicker()
  if (prev && prev !== next && attachments.value.length > 0) {
    void cleanupStagedAttachments()
  }
})

watch(text, () => {
  nextTick(() => resizeTextarea())
})

onBeforeUnmount(() => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  closeTagPicker()
  closeEmojiPicker()
  if (attachments.value.length > 0) {
    void cleanupStagedAttachments()
  }
})

onMounted(() => {
  nextTick(() => {
    resizeTextarea()
    captureSelection()
  })
})


function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
</script>
