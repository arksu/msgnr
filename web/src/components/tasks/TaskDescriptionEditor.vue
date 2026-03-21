<template>
  <div class="flex min-h-0 flex-col gap-2">
    <div class="inline-flex overflow-hidden rounded border border-chat-border text-[11px]">
      <button
        type="button"
        class="px-2 py-0.5"
        :class="tab === 'rendered' ? 'bg-accent text-white' : 'bg-chat-input text-gray-300 hover:text-white'"
        data-testid="task-description-tab-rendered"
        @click="switchTab('rendered')"
      >
        Rendered
      </button>
      <button
        type="button"
        class="border-l border-chat-border px-2 py-0.5"
        :class="tab === 'markdown' ? 'bg-accent text-white' : 'bg-chat-input text-gray-300 hover:text-white'"
        data-testid="task-description-tab-markdown"
        @click="switchTab('markdown')"
      >
        Markdown
      </button>
    </div>

    <div
      v-show="tab === 'rendered'"
      class="min-h-0 flex-1 overflow-y-auto rounded bg-chat-input p-2 space-y-2"
      data-testid="task-description-rendered"
    >
      <AttachmentMarkdownContent
        v-if="!editable"
        :markdown="markdownDraft"
      />
      <TaskDescriptionRichEditor
        v-else
        v-model="markdownDraft"
        :editable="editable"
        :collab-doc="collabDoc"
        :collab-provider="collabProvider"
        :collab-field="collabField"
        :allow-local-draft-seed="allowLocalDraftSeed"
        :force-local-sync-token="forceLocalSyncToken"
        :owner-kind="ownerKind"
        :owner-id="ownerId"
        :collab-user="collabUser"
        :upload-attachments="uploadAttachments"
        @blur="emit('blur')"
      />
    </div>

    <textarea
      v-show="tab === 'markdown'"
      ref="markdownInputRef"
      v-model="markdownDraft"
      class="min-h-[100px] w-full flex-1 resize-y rounded border border-chat-border bg-chat-input px-3 py-2 text-sm text-white outline-none focus:border-accent"
      :placeholder="placeholder"
      :disabled="!editable"
      data-testid="task-description-markdown-input"
      @blur="emit('blur')"
      @paste="onMarkdownPaste"
      @dragover="onMarkdownDragOver"
      @drop="onMarkdownDrop"
    />

    <p
      v-if="attachmentNotice"
      data-testid="task-description-attachment-note"
      class="text-xs"
      :class="attachmentNoticeIsError ? 'text-amber-300' : 'text-gray-500'"
    >
      {{ attachmentNotice }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import type { Doc as YDoc } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import AttachmentMarkdownContent from '@/components/AttachmentMarkdownContent.vue'
import { uploadOwnedAttachment, type OwnedAttachmentUpload } from '@/services/http/attachmentOwnersApi'
import { buildAttachmentMarkdown, type AttachmentOwnerKind } from '@/utils/attachmentMarkdown'

type DescriptionTab = 'rendered' | 'markdown'

const TaskDescriptionRichEditor = defineAsyncComponent(() => import('./TaskDescriptionRichEditor.vue'))

const props = withDefaults(defineProps<{
  modelValue: string
  defaultTab?: DescriptionTab
  placeholder?: string
  editable?: boolean
  collabDoc?: YDoc | null
  collabProvider?: { awareness: Awareness } | null
  collabField?: string
  allowLocalDraftSeed?: boolean
  forceLocalSyncToken?: number
  ownerKind?: AttachmentOwnerKind | null
  ownerId?: string | null
  collabUser?: {
    id: string
    name: string
    color: string
  } | null
}>(), {
  defaultTab: 'rendered',
  placeholder: 'Description',
  editable: true,
  collabDoc: null,
  collabProvider: null,
  collabField: 'task_description',
  allowLocalDraftSeed: true,
  forceLocalSyncToken: 0,
  ownerKind: null,
  ownerId: null,
  collabUser: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'blur': []
}>()

const tab = ref<DescriptionTab>(props.defaultTab)
const markdownDraft = ref(props.modelValue ?? '')
const markdownInputRef = ref<HTMLTextAreaElement | null>(null)
const attachmentNotice = ref('')
const attachmentNoticeIsError = ref(false)
const editable = computed(() => !!props.editable)

function setAttachmentNotice(message: string, isError = false) {
  attachmentNotice.value = message
  attachmentNoticeIsError.value = isError
}

function clearAttachmentNotice() {
  attachmentNotice.value = ''
  attachmentNoticeIsError.value = false
}

function attachmentsEnabledForUpload(): boolean {
  return editable.value && !!props.ownerKind && !!props.ownerId
}

function buildInsertedAttachmentMarkdown(ownerKind: AttachmentOwnerKind, ownerId: string, rows: OwnedAttachmentUpload[]): string {
  return rows.map(row => buildAttachmentMarkdown(
    ownerKind,
    ownerId,
    row.id,
    row.file_name,
    row.mime_type,
  )).join('\n\n')
}

async function uploadAttachments(files: File[]): Promise<OwnedAttachmentUpload[] | null> {
  if (!files.length) return null
  if (!attachmentsEnabledForUpload()) {
    setAttachmentNotice('Attachments are available after save.')
    return null
  }
  const ownerKind = props.ownerKind
  const ownerId = props.ownerId
  if (!ownerKind || !ownerId) {
    setAttachmentNotice('Attachments are available after save.')
    return null
  }

  setAttachmentNotice(`Uploading ${files.length === 1 ? 'attachment' : `${files.length} attachments`}...`)
  try {
    const uploaded = await Promise.all(files.map(file => uploadOwnedAttachment(ownerKind, ownerId, file)))
    clearAttachmentNotice()
    return uploaded
  } catch (error) {
    setAttachmentNotice(error instanceof Error ? error.message : 'Attachment upload failed', true)
    return null
  }
}

function insertMarkdownAtCursor(value: string) {
  const input = markdownInputRef.value
  if (!input) {
    markdownDraft.value = [markdownDraft.value, value].filter(Boolean).join('\n\n')
    emit('update:modelValue', markdownDraft.value)
    return
  }
  const start = input.selectionStart ?? markdownDraft.value.length
  const end = input.selectionEnd ?? start
  const before = markdownDraft.value.slice(0, start)
  const after = markdownDraft.value.slice(end)
  const needsLeadingBreak = before.length > 0 && !before.endsWith('\n')
  const needsTrailingBreak = after.length > 0 && !after.startsWith('\n')
  const inserted = `${needsLeadingBreak ? '\n\n' : ''}${value}${needsTrailingBreak ? '\n\n' : ''}`
  markdownDraft.value = `${before}${inserted}${after}`
  emit('update:modelValue', markdownDraft.value)
  nextTick(() => {
    const caret = before.length + inserted.length
    input.focus()
    input.setSelectionRange(caret, caret)
  })
}

async function onMarkdownPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  const uploaded = await uploadAttachments(files)
  if (!uploaded || !props.ownerKind || !props.ownerId) return
  insertMarkdownAtCursor(buildInsertedAttachmentMarkdown(props.ownerKind, props.ownerId, uploaded))
}

function onMarkdownDragOver(event: DragEvent) {
  if ((event.dataTransfer?.files?.length ?? 0) > 0) {
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'copy'
  }
}

async function onMarkdownDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  const uploaded = await uploadAttachments(files)
  if (!uploaded || !props.ownerKind || !props.ownerId) return
  insertMarkdownAtCursor(buildInsertedAttachmentMarkdown(props.ownerKind, props.ownerId, uploaded))
}

function switchTab(nextTab: DescriptionTab) {
  tab.value = nextTab
}

watch(
  () => props.modelValue,
  (next) => {
    const normalized = next ?? ''
    if (normalized === markdownDraft.value) return
    markdownDraft.value = normalized
  },
)

watch(markdownDraft, (next) => {
  if (next !== props.modelValue) {
    emit('update:modelValue', next)
  }
})

watch(
  [() => props.ownerId, () => props.ownerKind, editable],
  ([ownerId, ownerKind, isEditable]) => {
    if (!isEditable) return
    if (!ownerId || !ownerKind) {
      setAttachmentNotice('Attachments are available after save.')
      return
    }
    if (!attachmentNoticeIsError.value) {
      clearAttachmentNotice()
    }
  },
  { immediate: true },
)
</script>
