<template>
  <div>
    <div class="mb-3">
      <span class="text-xs text-gray-500 uppercase tracking-wide">
        Comments ({{ comments.length }})
      </span>
    </div>

    <p v-if="error" class="mb-2 text-xs text-red-400">{{ error }}</p>

    <div v-if="loading" class="text-sm text-gray-500 italic">Loading…</div>

    <p v-else-if="!comments.length && !submitting" class="mb-3 text-sm text-gray-500 italic">
      No comments yet
    </p>

    <ul v-else class="mb-4 space-y-3">
      <li
        v-for="comment in comments"
        :key="comment.id"
        class="flex gap-3"
      >
        <UserAvatar
          :user-id="comment.author_id"
          :display-name="authorName(comment.author_id)"
          :avatar-url="authorAvatar(comment.author_id)"
          size="sm"
        />

        <div class="min-w-0 flex-1">
          <div class="mb-1 flex items-baseline gap-2">
            <span class="text-sm font-medium text-gray-200">{{ authorName(comment.author_id) }}</span>
            <span class="text-xs text-gray-500">{{ formatDatetime(comment.created_at) }}</span>
          </div>

          <p v-if="comment.body" class="break-words whitespace-pre-wrap text-sm text-gray-300">{{ comment.body }}</p>

          <div v-if="comment.attachments?.length" class="mt-2 space-y-2">
            <div
              v-for="attachment in comment.attachments"
              :key="attachment.id"
              class="rounded-md border border-chat-border bg-chat-input/70 p-2"
            >
              <div class="mb-1 flex items-center justify-between gap-2">
                <p class="truncate text-xs text-gray-300">{{ attachment.file_name }}</p>
                <button
                  class="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
                  title="Download"
                  @click="downloadAttachment(comment.id, attachment)"
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
                @click="openImagePreview(comment.id, attachment)"
              >
                <img
                  v-if="attachmentUrl(attachment)"
                  :src="attachmentUrl(attachment)"
                  :alt="attachment.file_name"
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
                {{ formatFileSize(attachment.file_size) }}
              </p>
            </div>
          </div>
        </div>
      </li>
    </ul>

    <div class="space-y-2">
      <div v-if="stagedAttachments.length > 0" class="rounded-lg border border-chat-border bg-chat-input/70 p-2">
        <p class="mb-1 text-[11px] text-gray-500">Attachments ({{ stagedAttachments.length }}/{{ MAX_ATTACHMENTS }})</p>
        <ul class="space-y-1">
          <li
            v-for="attachment in stagedAttachments"
            :key="attachment.id"
            class="flex items-center justify-between gap-2 rounded border border-chat-border bg-chat-input px-2 py-1"
          >
            <div class="min-w-0">
              <p class="truncate text-xs text-gray-200">{{ attachment.file_name }}</p>
              <p class="text-[11px] text-gray-500">{{ formatFileSize(attachment.file_size) }}</p>
            </div>
            <button
              class="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
              title="Remove attachment"
              :disabled="removingAttachmentIds.has(attachment.id)"
              @click="removeStagedAttachment(attachment.id)"
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
          class="mb-0.5 shrink-0 text-gray-400 transition-colors hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="submitting || uploading || stagedAttachments.length >= MAX_ATTACHMENTS"
          :title="attachButtonTitle"
          @click="openFilePicker"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>

        <textarea
          v-model="newBody"
          class="min-h-[24px] max-h-40 flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-gray-100 placeholder-gray-500 outline-none"
          placeholder="Add a comment…"
          :disabled="submitting"
          rows="1"
          @keydown.enter.exact.prevent="submit"
          @keydown.shift.enter.exact.prevent.stop="onShiftEnter"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent="onDragOver"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        />

        <button
          class="mb-0.5 shrink-0 rounded p-1.5 transition-colors"
          :class="canSubmit
            ? 'bg-accent text-white hover:bg-accent-hover'
            : 'cursor-not-allowed text-gray-600'"
          :disabled="!canSubmit"
          @click="submit"
        >
          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/>
          </svg>
        </button>
      </div>

      <div class="flex items-center justify-between">
        <span v-if="uploading" class="text-[11px] text-gray-500">Uploading attachments...</span>
        <span v-else-if="attachmentError" class="text-[11px] text-red-400">{{ attachmentError }}</span>
        <span v-else class="text-xs text-gray-500">Enter to post · Shift+Enter for new line</span>
        <span class="text-xs text-gray-500">{{ submitting ? 'Posting…' : '' }}</span>
      </div>
    </div>

    <div
      v-if="imagePreview.open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      @click.self="closeImagePreview"
    >
      <div class="max-h-full max-w-5xl overflow-hidden rounded-lg border border-chat-border bg-chat-header">
        <div class="flex items-center justify-between border-b border-chat-border px-3 py-2">
          <p class="truncate text-sm text-gray-200">{{ imagePreview.fileName }}</p>
          <button
            class="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
            @click="closeImagePreview"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <img :src="imagePreview.src" :alt="imagePreview.fileName" class="max-h-[75vh] w-full object-contain">
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick, reactive } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import UserAvatar from '@/components/UserAvatar.vue'
import {
  tasksListComments,
  tasksCreateComment,
  tasksUploadCommentAttachment,
  tasksDeleteCommentAttachment,
  tasksFetchCommentAttachmentBlob,
  type TaskComment,
  type TaskCommentAttachment,
} from '@/services/http/tasksApi'

const MAX_ATTACHMENTS = 5

const props = defineProps<{ taskId: string }>()

const tasksStore = useTasksStore()
const comments = ref<TaskComment[]>([])
const loading = ref(false)
const error = ref('')
const newBody = ref('')
const submitting = ref(false)

const fileInputEl = ref<HTMLInputElement | null>(null)
const stagedAttachments = ref<TaskCommentAttachment[]>([])
const uploading = ref(false)
const attachmentError = ref('')
const removingAttachmentIds = ref(new Set<string>())
const isDragOver = ref(false)
let dragDepth = 0

const attachmentUrls = ref<Record<string, string>>({})
const loadingAttachmentIds = ref(new Set<string>())

const imagePreview = reactive({
  open: false,
  src: '',
  fileName: '',
})

const canSubmit = computed(() => {
  if (submitting.value || uploading.value) return false
  if (newBody.value.trim().length > 0) return true
  return stagedAttachments.value.length > 0
})

const attachButtonTitle = computed(() => {
  if (stagedAttachments.value.length >= MAX_ATTACHMENTS) return `Max ${MAX_ATTACHMENTS} attachments per comment`
  return 'Attach file'
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    comments.value = await tasksListComments(props.taskId)
    preloadAttachmentUrls()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load comments'
  } finally {
    loading.value = false
  }
}

function openFilePicker() {
  fileInputEl.value?.click()
}

async function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  await uploadFiles(files)
}

async function uploadFiles(files: File[]) {
  if (submitting.value || uploading.value) return
  attachmentError.value = ''
  const remainingSlots = MAX_ATTACHMENTS - stagedAttachments.value.length
  if (remainingSlots <= 0) {
    attachmentError.value = `Max ${MAX_ATTACHMENTS} attachments per comment`
    return
  }
  const selected = files.slice(0, remainingSlots)
  if (selected.length < files.length) {
    attachmentError.value = `Only ${MAX_ATTACHMENTS} attachments are allowed per comment`
  }

  uploading.value = true
  try {
    for (const file of selected) {
      const uploaded = await tasksUploadCommentAttachment(props.taskId, file)
      stagedAttachments.value.push(uploaded)
    }
  } catch (e) {
    attachmentError.value = e instanceof Error ? e.message : 'Failed to upload attachment'
  } finally {
    uploading.value = false
  }
}

async function removeStagedAttachment(attachmentId: string) {
  removingAttachmentIds.value.add(attachmentId)
  attachmentError.value = ''
  try {
    await tasksDeleteCommentAttachment(props.taskId, attachmentId)
    stagedAttachments.value = stagedAttachments.value.filter(item => item.id !== attachmentId)
  } catch (e) {
    attachmentError.value = e instanceof Error ? e.message : 'Failed to remove attachment'
  } finally {
    removingAttachmentIds.value.delete(attachmentId)
  }
}

async function cleanupStagedAttachments(taskId: string = props.taskId) {
  const ids = stagedAttachments.value.map(item => item.id)
  stagedAttachments.value = []
  await Promise.allSettled(ids.map(async id => {
    try {
      await tasksDeleteCommentAttachment(taskId, id)
    } catch {
      // Best-effort cleanup only.
    }
  }))
}

function isFileDragEvent(event: DragEvent): boolean {
  return event.dataTransfer?.types?.includes('Files') ?? false
}

function onDragEnter(event: DragEvent) {
  if (!isFileDragEvent(event) || submitting.value || uploading.value) return
  dragDepth += 1
  isDragOver.value = true
}

function onDragOver(event: DragEvent) {
  if (!isFileDragEvent(event) || submitting.value || uploading.value) return
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isDragOver.value = true
}

function onDragLeave(_event: DragEvent) {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) {
    isDragOver.value = false
  }
}

async function onDrop(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  dragDepth = 0
  isDragOver.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length === 0) return
  await uploadFiles(files)
}

function onShiftEnter(event: KeyboardEvent) {
  const el = event.target as HTMLTextAreaElement
  const start = el.selectionStart
  const end = el.selectionEnd
  newBody.value = newBody.value.slice(0, start) + '\n' + newBody.value.slice(end)
  nextTick(() => {
    el.selectionStart = el.selectionEnd = start + 1
  })
}

async function submit() {
  const body = newBody.value.trim()
  if ((!body && stagedAttachments.value.length === 0) || submitting.value || uploading.value) return
  submitting.value = true
  error.value = ''
  attachmentError.value = ''
  try {
    const comment = await tasksCreateComment(props.taskId, {
      body,
      attachment_ids: stagedAttachments.value.map(item => item.id),
    })
    comments.value.push(comment)
    newBody.value = ''
    stagedAttachments.value = []
    preloadAttachmentUrls()
    tasksStore.loadUsers()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to post comment'
  } finally {
    submitting.value = false
  }
}

function authorName(authorId: string): string {
  const user = tasksStore.users.find(u => u.id === authorId)
  return user?.display_name ?? authorId.slice(0, 8)
}

function authorAvatar(authorId: string): string {
  const user = tasksStore.users.find(u => u.id === authorId)
  return user?.avatar_url ?? ''
}

function formatDatetime(v: string): string {
  return v ? new Date(v).toLocaleString() : ''
}

function isImageAttachment(attachment: TaskCommentAttachment): boolean {
  return attachment.mime_type.startsWith('image/')
}

function isVideoAttachment(attachment: TaskCommentAttachment): boolean {
  return attachment.mime_type.startsWith('video/')
}

function isAudioAttachment(attachment: TaskCommentAttachment): boolean {
  return attachment.mime_type.startsWith('audio/')
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentUrl(attachment: TaskCommentAttachment): string {
  return attachmentUrls.value[attachment.id] ?? ''
}

function revokeAttachmentUrl(attachmentId: string) {
  const url = attachmentUrls.value[attachmentId]
  if (!url) return
  URL.revokeObjectURL(url)
  delete attachmentUrls.value[attachmentId]
}

function revokeAllAttachmentUrls() {
  for (const id of Object.keys(attachmentUrls.value)) {
    revokeAttachmentUrl(id)
  }
  attachmentUrls.value = {}
  loadingAttachmentIds.value.clear()
}

async function ensureAttachmentUrl(commentId: string, attachment: TaskCommentAttachment) {
  if (attachmentUrls.value[attachment.id]) return
  if (loadingAttachmentIds.value.has(attachment.id)) return

  loadingAttachmentIds.value.add(attachment.id)
  try {
    const blob = await tasksFetchCommentAttachmentBlob(props.taskId, commentId, attachment.id)
    attachmentUrls.value[attachment.id] = URL.createObjectURL(blob)
  } catch {
    // Preview remains unavailable; keep UI fallback text.
  } finally {
    loadingAttachmentIds.value.delete(attachment.id)
  }
}

function preloadAttachmentUrls() {
  for (const comment of comments.value) {
    for (const attachment of comment.attachments ?? []) {
      if (isImageAttachment(attachment) || isVideoAttachment(attachment) || isAudioAttachment(attachment)) {
        void ensureAttachmentUrl(comment.id, attachment)
      }
    }
  }
}

async function downloadAttachment(commentId: string, attachment: TaskCommentAttachment) {
  try {
    const blob = await tasksFetchCommentAttachmentBlob(props.taskId, commentId, attachment.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = attachment.file_name
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to download attachment'
  }
}

async function openImagePreview(commentId: string, attachment: TaskCommentAttachment) {
  let src = attachmentUrl(attachment)
  if (!src) {
    await ensureAttachmentUrl(commentId, attachment)
    src = attachmentUrl(attachment)
  }
  if (!src) return
  imagePreview.open = true
  imagePreview.src = src
  imagePreview.fileName = attachment.file_name
}

function closeImagePreview() {
  imagePreview.open = false
  imagePreview.src = ''
  imagePreview.fileName = ''
}

watch(comments, () => {
  preloadAttachmentUrls()
}, { deep: true })

watch(() => props.taskId, (next, prev) => {
  if (prev && prev !== next) {
    void cleanupStagedAttachments(prev)
    revokeAllAttachmentUrls()
    newBody.value = ''
    closeImagePreview()
    void load()
  }
})

onMounted(() => {
  void load()
  void tasksStore.loadUsers()
})

onBeforeUnmount(() => {
  if (stagedAttachments.value.length > 0) {
    void cleanupStagedAttachments()
  }
  closeImagePreview()
  revokeAllAttachmentUrls()
})
</script>

<style scoped>
</style>
