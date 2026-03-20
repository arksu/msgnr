<template>
  <div
    v-if="!documentsStore.selectedDocument && !documentsStore.documentLoading"
    class="flex h-full items-center justify-center text-sm text-gray-500"
  >
    Select a document
  </div>

  <div
    v-else-if="documentsStore.documentLoading"
    class="flex h-full items-center justify-center text-sm text-gray-500"
  >
    Loading...
  </div>

  <div
    v-else-if="documentsStore.documentError"
    class="flex h-full items-center justify-center text-sm text-red-400"
  >
    {{ documentsStore.documentError }}
  </div>

  <div v-else-if="documentItem" class="flex h-full flex-col overflow-hidden">
    <div class="flex items-start justify-between gap-4 border-b border-chat-border px-6 py-4">
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          class="shrink-0 text-xs text-gray-500 transition-colors hover:text-white"
          @click="$emit('back')"
        >
          Back
        </button>
        <button
          v-if="documentItem.parent_document_id"
          type="button"
          class="shrink-0 text-xs text-gray-500 transition-colors hover:text-white"
          @click="$emit('openParent', documentItem.parent_document_id)"
        >
          {{ documentItem.parent_title ?? 'Parent document' }}
        </button>
        <span class="rounded border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs text-accent">
          {{ documentItem.teamspace_name }}
        </span>
        <input
          v-if="titleEditing"
          ref="titleInputRef"
          v-model="titleDraft"
          type="text"
          class="min-w-0 flex-1 rounded border border-chat-border bg-chat-input px-3 py-1 text-sm text-white outline-none focus:border-accent"
          @keydown.enter.prevent="saveTitle"
          @keydown.esc.prevent="cancelTitleEdit"
          @blur="saveTitle"
        >
        <div v-else class="flex min-w-0 items-center gap-2">
          <h1 class="truncate text-base font-semibold text-white">{{ documentItem.title }}</h1>
          <button
            type="button"
            class="rounded p-1 text-gray-500 transition-colors hover:text-white"
            title="Edit title"
            @click="startTitleEdit"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        </div>
      </div>
      <button
        type="button"
        data-testid="documents-history-button"
        class="rounded border border-chat-border px-2 py-1 text-xs text-gray-300 transition-colors hover:border-accent/50 hover:text-white"
        @click="openHistoryModal"
      >
        History
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-6 py-4">
      <div v-if="saveError" class="mb-3 text-xs text-red-400">{{ saveError }}</div>

      <TaskDescriptionEditor
        v-model="contentDraft"
        owner-kind="document"
        :owner-id="documentItem.id"
        placeholder="Document content"
        @blur="saveContent"
      />

      <div class="mt-6 flex gap-6 border-t border-chat-border pt-4 text-xs text-gray-500">
        <div>
          <span class="uppercase tracking-wide">Created</span>
          <div class="mt-0.5 text-gray-400">{{ formatDatetime(documentItem.created_at) }}</div>
        </div>
        <div>
          <span class="uppercase tracking-wide">Updated</span>
          <div class="mt-0.5 text-gray-400">{{ formatDatetime(documentItem.updated_at) }}</div>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="historyModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeHistoryModal"
    >
      <div class="w-full max-w-5xl rounded-xl border border-chat-border bg-chat-header p-4 shadow-2xl">
        <h3 class="mb-3 text-base font-semibold text-white">Document History</h3>
        <div class="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside class="rounded border border-chat-border bg-chat-input/40 p-2">
            <div class="mb-2 text-xs uppercase tracking-wide text-gray-400">Versions</div>
            <p v-if="historyLoading" class="px-2 py-2 text-xs text-gray-500">Loading versions...</p>
            <p v-else-if="historyError" class="px-2 py-2 text-xs text-red-400">{{ historyError }}</p>
            <p v-else-if="historyItems.length === 0" class="px-2 py-2 text-xs text-gray-500">No versions yet</p>
            <ul v-else class="max-h-[420px] space-y-1 overflow-y-auto pr-1">
              <li v-for="item in historyItems" :key="`${item.created_at}:${item.edited_by}`">
                <button
                  type="button"
                  class="flex w-full items-start gap-2 rounded border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                  :class="historyCandidate === item ? 'border-accent/50 bg-accent/20' : ''"
                  @click="selectHistoryItem(item)"
                >
                  <UserAvatar
                    :user-id="item.editor.id"
                    :display-name="item.editor.display_name"
                    :avatar-url="item.editor.avatar_url"
                    size="xs"
                  />
                  <span class="min-w-0">
                    <span class="block truncate text-xs text-gray-200">{{ item.editor.display_name }}</span>
                    <span class="block text-[11px] text-gray-500">{{ formatDatetime(item.created_at) }}</span>
                  </span>
                </button>
              </li>
            </ul>
          </aside>

          <div class="space-y-3">
            <template v-if="historyCandidate">
              <div>
                <div class="mb-1 text-xs uppercase tracking-wide text-gray-400">Title</div>
                <input
                  :value="historyCandidate.title"
                  type="text"
                  readonly
                  class="w-full rounded border border-chat-border bg-chat-input px-2 py-1 text-sm text-gray-200"
                >
              </div>
              <div>
                <div class="mb-1 text-xs uppercase tracking-wide text-gray-400">Content</div>
                <div class="max-h-[420px] overflow-y-auto pr-1">
                  <TaskDescriptionEditor v-model="historyPreviewDraft" :editable="false" />
                </div>
              </div>
            </template>
            <p v-else class="rounded border border-chat-border bg-chat-input px-3 py-4 text-sm italic text-gray-500">
              Select a history item to preview
            </p>
          </div>
        </div>
        <p v-if="historyApplyError" class="mt-3 text-xs text-red-400">{{ historyApplyError }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded border border-chat-border px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-white"
            :disabled="historyApplying"
            @click="closeHistoryModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            :disabled="historyApplying || !historyCandidate"
            @click="applyHistory"
          >
            {{ historyApplying ? 'Applying...' : 'Apply' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { DocumentHistoryItem } from '@/services/http/documentsApi'
import { useDocumentsStore } from '@/stores/documents'
import TaskDescriptionEditor from '@/components/tasks/TaskDescriptionEditor.vue'
import UserAvatar from '@/components/UserAvatar.vue'

defineEmits<{
  back: []
  openParent: [id: string]
}>()

const documentsStore = useDocumentsStore()
const titleEditing = ref(false)
const titleDraft = ref('')
const contentDraft = ref('')
const saveError = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)
const autosaveDelayMs = 20_000
let autosaveTimer: ReturnType<typeof setTimeout> | null = null

const historyModalOpen = ref(false)
const historyLoading = ref(false)
const historyError = ref('')
const historyItems = ref<DocumentHistoryItem[]>([])
const historyCandidate = ref<DocumentHistoryItem | null>(null)
const historyPreviewDraft = ref('')
const historyApplying = ref(false)
const historyApplyError = ref('')

const documentItem = computed(() => documentsStore.selectedDocument)

watch(
  () => documentsStore.selectedDocument,
  (value, previous) => {
    clearAutosaveTimer()
    titleDraft.value = value?.title ?? ''
    contentDraft.value = value?.content_markdown ?? ''
    if (value?.id !== previous?.id) {
      titleEditing.value = false
    }
    saveError.value = ''
  },
  { immediate: true },
)

watch([titleDraft, contentDraft], () => {
  scheduleAutosave()
})

onBeforeUnmount(() => {
  clearAutosaveTimer()
})

function formatDatetime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

async function startTitleEdit() {
  titleEditing.value = true
  await nextTick()
  titleInputRef.value?.focus()
  titleInputRef.value?.select()
}

function cancelTitleEdit() {
  titleEditing.value = false
  titleDraft.value = documentsStore.selectedDocument?.title ?? ''
}

function clearAutosaveTimer() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
}

function collectDraftChanges(documentItem: NonNullable<typeof documentsStore.selectedDocument>): {
  payload: { title?: string; content_markdown?: string }
  titleInvalid: boolean
} {
  const payload: { title?: string; content_markdown?: string } = {}
  const nextTitle = titleDraft.value.trim()
  const currentContent = documentItem.content_markdown ?? ''
  let titleInvalid = false

  if (!nextTitle) {
    if (titleDraft.value !== documentItem.title) {
      titleInvalid = true
    }
  } else if (nextTitle !== documentItem.title) {
    payload.title = nextTitle
  }

  if (contentDraft.value !== currentContent) {
    payload.content_markdown = contentDraft.value
  }

  return { payload, titleInvalid }
}

async function persistDraft(options: { closeTitleEditor?: boolean } = {}) {
  const current = documentsStore.selectedDocument
  if (!current) return
  const documentId = current.id
  const submittedTitleDraft = titleDraft.value
  const submittedContentDraft = contentDraft.value
  const { payload, titleInvalid } = collectDraftChanges(current)

  if (titleInvalid) {
    saveError.value = 'Document title is required'
  } else {
    saveError.value = ''
  }

  if (Object.keys(payload).length === 0) {
    if (options.closeTitleEditor && !titleInvalid) {
      titleEditing.value = false
    }
    return
  }

  try {
    const row = await documentsStore.updateDocument(documentId, payload)
    if (documentsStore.selectedDocument?.id !== documentId) return
    if (payload.title !== undefined && titleDraft.value === submittedTitleDraft) {
      titleDraft.value = row.title
    }
    if (payload.content_markdown !== undefined && contentDraft.value === submittedContentDraft) {
      contentDraft.value = row.content_markdown ?? ''
    }
    if (options.closeTitleEditor && !titleInvalid) {
      titleEditing.value = false
    }
    saveError.value = titleInvalid ? 'Document title is required' : ''
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save document'
  }
}

function scheduleAutosave() {
  const current = documentsStore.selectedDocument
  if (!current) return
  const { payload, titleInvalid } = collectDraftChanges(current)
  if (Object.keys(payload).length === 0 && !titleInvalid) {
    clearAutosaveTimer()
    return
  }
  clearAutosaveTimer()
  const documentId = current.id
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    if (documentsStore.selectedDocument?.id !== documentId) return
    void persistDraft()
  }, autosaveDelayMs)
}

async function saveTitle() {
  clearAutosaveTimer()
  await persistDraft({ closeTitleEditor: true })
}

async function saveContent() {
  clearAutosaveTimer()
  await persistDraft()
}

async function openHistoryModal() {
  const current = documentsStore.selectedDocument
  if (!current) return
  historyModalOpen.value = true
  historyLoading.value = true
  historyError.value = ''
  historyApplyError.value = ''
  historyCandidate.value = null
  try {
    historyItems.value = await documentsStore.loadDocumentHistory(current.id)
  } catch (e) {
    historyItems.value = []
    historyError.value = e instanceof Error ? e.message : 'Failed to load history'
  } finally {
    historyLoading.value = false
  }
}

function closeHistoryModal() {
  historyModalOpen.value = false
  historyApplyError.value = ''
}

function selectHistoryItem(item: DocumentHistoryItem) {
  historyCandidate.value = item
  historyPreviewDraft.value = item.content_markdown ?? ''
}

async function applyHistory() {
  const current = documentsStore.selectedDocument
  const candidate = historyCandidate.value
  if (!current || !candidate) return
  clearAutosaveTimer()
  historyApplying.value = true
  historyApplyError.value = ''
  try {
    const row = await documentsStore.updateDocument(current.id, {
      title: candidate.title,
      content_markdown: candidate.content_markdown ?? null,
    })
    titleDraft.value = row.title
    contentDraft.value = row.content_markdown ?? ''
    closeHistoryModal()
  } catch (e) {
    historyApplyError.value = e instanceof Error ? e.message : 'Failed to restore version'
  } finally {
    historyApplying.value = false
  }
}
</script>
