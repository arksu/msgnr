<template>
  <div
    v-if="!tasksStore.selectedTask && !tasksStore.taskLoading"
    class="flex h-full items-center justify-center text-gray-500 text-sm"
  >
    Select a task or create a new one
  </div>

  <div v-else-if="tasksStore.taskLoading" class="flex h-full items-center justify-center text-gray-500 text-sm">
    Loading...
  </div>

  <div v-else-if="tasksStore.taskError" class="flex h-full items-center justify-center text-red-400 text-sm">
    {{ tasksStore.taskError }}
  </div>

  <div v-else-if="task" class="flex flex-col h-full overflow-hidden">
    <!-- Header -->
    <div class="flex items-start justify-between px-6 py-4 border-b border-chat-border shrink-0 gap-4">
      <div class="flex items-center gap-3 min-w-0">
        <button
          class="shrink-0 flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
          @click="emit('back')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path d="M15 19l-7-7 7-7"/>
          </svg>
          Back
        </button>

        <!-- Parent breadcrumb (subtasks only) -->
        <button
          v-if="task.parent_task_id"
          class="shrink-0 flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
          @click="tasksStore.selectTask(task.parent_task_id!, true)"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M3 7h18M3 12h12M3 17h7"/>
          </svg>
          {{ task.parent_public_id ?? 'Parent task' }}
        </button>

        <span class="font-mono text-xs text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded shrink-0">
          {{ task.public_id }}
        </span>
        <input
          v-if="titleEditing"
          ref="titleInputRef"
          v-model="titleDraft"
          type="text"
          class="flex-1 min-w-0 bg-chat-input border border-chat-border rounded px-3 py-1 text-white text-sm outline-none focus:border-accent"
          :disabled="titleSaving"
          placeholder="Task title"
          @keydown.enter.prevent="saveTitle"
          @keydown.esc.prevent="cancelTitleEdit"
          @blur="saveTitle"
        />
        <div v-else class="flex min-w-0 items-center gap-1.5">
          <h1 class="text-base font-semibold text-white truncate">{{ task.title }}</h1>
          <button
            class="shrink-0 rounded p-1 text-gray-500 hover:text-white transition-colors"
            type="button"
            title="Edit title"
            @click="startTitleEdit"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0" />
    </div>

    <!-- Save error -->
    <div v-if="saveError" class="px-6 py-2 text-red-400 text-sm border-b border-chat-border shrink-0">
      {{ saveError }}
    </div>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-5">

      <!-- Status row -->
      <div class="flex items-center gap-6 flex-wrap">
        <div>
          <div class="field-label">Status</div>
          <select
            v-model="viewStatusId"
            class="field-select"
            :disabled="statusSaving"
            @change="onViewStatusChange"
          >
            <!--
              Render all statuses so a task with a soft-deleted status still has
              a visible selection. Deleted entries are disabled so the user is
              nudged to pick an active one, but the server is the final arbiter.
            -->
            <option
              v-for="s in tasksStore.allStatuses()"
              :key="s.id"
              :value="s.id"
              :disabled="!!s.deleted_at"
            >
              {{ s.name }}{{ s.deleted_at ? ' (deleted)' : '' }}
            </option>
          </select>
        </div>
      </div>

      <!-- Custom fields -->
      <div v-if="customFields.length > 0" class="border-t border-chat-border pt-4 space-y-4">
        <div v-for="field in customFields" :key="field.id">
          <div
            class="field-label"
            :class="isFieldMissing(field.id) ? 'text-red-400' : ''"
          >
            {{ field.name }}
            <span v-if="field.required" class="text-red-400">*</span>
          </div>
          <TaskFieldInput
            :field="field"
            :value="fieldInputValue(field)"
            mode="edit"
            :users="tasksStore.users"
            :enum-items="field.enum_dictionary_id ? tasksStore.enumItemsFor(field.enum_dictionary_id) : undefined"
            @update:value="onFieldValueChange(field, $event)"
          />
          <p v-if="isFieldMissing(field.id)" class="text-red-400 text-xs mt-1">
            This field is required
          </p>
        </div>
      </div>

      <!-- Subtasks (top-level tasks only) -->
      <div v-if="!task.parent_task_id" class="border-t border-chat-border pt-4 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500 uppercase tracking-wide">
            Subtasks ({{ task.subtasks?.length ?? 0 }})
          </span>
          <button
            v-if="!showSubtaskForm"
            class="text-xs text-accent hover:text-accent-hover transition-colors"
            @click="openSubtaskForm"
          >
            + Add subtask
          </button>
        </div>

        <!-- Existing subtasks list -->
        <div v-if="task.subtasks?.length" class="space-y-1.5">
          <div
            v-for="sub in task.subtasks"
            :key="sub.id"
            class="flex items-center gap-2 px-3 py-2 rounded bg-chat-input border border-chat-border hover:border-accent/40 transition-colors cursor-pointer group"
            @click="tasksStore.selectTask(sub.id)"
          >
            <span class="font-mono text-xs text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded shrink-0">
              {{ sub.public_id }}
            </span>
            <span class="flex-1 text-sm text-gray-200 truncate">{{ sub.title }}</span>
            <span class="text-xs text-gray-500 group-hover:text-gray-300 transition-colors shrink-0">
              {{ tasksStore.statusById(sub.status_id)?.name ?? '' }}
            </span>
            <svg class="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-300 transition-colors shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M9 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
        <p v-else-if="!showSubtaskForm" class="text-sm text-gray-500 italic">No subtasks yet</p>

        <!-- Inline subtask creation form -->
        <div v-if="showSubtaskForm" class="border border-chat-border rounded-lg p-4 space-y-3 bg-chat-input">
          <div class="text-xs text-gray-400 font-medium uppercase tracking-wide">New subtask</div>

          <!-- Template selector -->
          <div>
            <label class="form-label">Template</label>
            <div class="flex gap-2 flex-wrap">
              <button
                v-for="tpl in tasksStore.activeTemplates"
                :key="tpl.id"
                type="button"
                class="px-3 py-1 rounded text-xs border transition-colors"
                :class="subtaskForm.templateId === tpl.id
                  ? 'bg-accent border-accent text-white'
                  : 'border-chat-border text-gray-300 hover:border-accent/60 hover:text-white'"
                @click="selectSubtaskTemplate(tpl.id)"
              >
                {{ tpl.prefix }}
              </button>
            </div>
          </div>

          <!-- Title -->
          <div>
            <label class="form-label">Title <span class="text-red-400">*</span></label>
            <input
              v-model="subtaskForm.title"
              type="text"
              class="w-full bg-chat-bg border border-chat-border rounded px-3 py-1.5 text-white text-sm outline-none focus:border-accent transition-colors"
              placeholder="Subtask title"
            />
          </div>

          <!-- Description -->
          <div>
            <label class="form-label">Description</label>
            <TaskDescriptionEditor
              v-model="subtaskForm.description"
              placeholder="Optional"
            />
          </div>

          <!-- Status -->
          <div>
            <label class="form-label">Status <span class="text-red-400">*</span></label>
            <select v-model="subtaskForm.statusId" class="w-full bg-chat-bg border border-chat-border rounded px-3 py-1.5 text-white text-sm outline-none focus:border-accent transition-colors">
              <option value="">— select status —</option>
              <option v-for="s in tasksStore.activeStatuses" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>

          <!-- Custom fields for selected subtask template -->
          <template v-for="field in subtaskFields" :key="field.id">
            <div>
              <label
                class="form-label"
                :class="isSubtaskFieldMissing(field.id) ? 'text-red-400' : ''"
              >
                {{ field.name }}
                <span v-if="field.required" class="text-red-400">*</span>
              </label>
              <TaskFieldInput
                :field="field"
                :value="subtaskCustomValues[field.id]"
                mode="edit"
                :users="tasksStore.users"
                :enum-items="field.enum_dictionary_id ? tasksStore.enumItemsFor(field.enum_dictionary_id) : undefined"
                @update:value="subtaskCustomValues[field.id] = $event"
              />
              <p v-if="isSubtaskFieldMissing(field.id)" class="text-red-400 text-xs mt-1">
                This field is required
              </p>
            </div>
          </template>

          <!-- Form error -->
          <p v-if="subtaskError" class="text-red-400 text-xs">{{ subtaskError }}</p>

          <!-- Actions -->
          <div class="flex justify-end gap-2 pt-1">
            <button
              class="btn-secondary text-xs"
              :disabled="subtaskSaving"
              @click="cancelSubtaskForm"
            >
              Cancel
            </button>
            <button
              class="btn-primary text-xs"
              :disabled="!canSubmitSubtask || subtaskSaving"
              @click="submitSubtask"
            >
              {{ subtaskSaving ? 'Creating...' : 'Create subtask' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Description -->
      <div class="border-t border-chat-border pt-4">
        <div class="field-label flex items-center justify-between gap-2">
          <span>Description</span>
          <span v-if="descriptionSaving" class="text-[11px] text-gray-500 normal-case tracking-normal">Saving...</span>
        </div>
        <TaskDescriptionEditor
          v-if="taskDescriptionDoc"
          v-model="descriptionDraft"
          :collab-doc="taskDescriptionDoc"
          :collab-provider="taskDescriptionProvider"
          :allow-local-draft-seed="taskDescriptionAllowLocalDraftSeed"
          :collab-user="collabUser"
          placeholder="Description"
          @blur="flushDescriptionNow"
        />
        <div
          v-else-if="descriptionDraft"
          class="rounded bg-chat-input p-3 text-sm text-gray-100 leading-relaxed markdown-body pointer-events-none select-none opacity-70"
          v-html="descriptionPreviewHtml"
        />
        <p v-else class="text-sm text-gray-500 italic">No description</p>
        <p v-if="descriptionSaveError" class="text-xs text-amber-300 mt-2">
          {{ descriptionSaveError }}
        </p>
        <p v-if="taskDescriptionCollabError" class="text-xs text-amber-300 mt-1">
          {{ taskDescriptionCollabError }}
        </p>
      </div>

      <!-- Attachments -->
      <div class="border-t border-chat-border pt-4">
        <TaskAttachments :task-id="task.id" />
      </div>

      <!-- Comments -->
      <div class="border-t border-chat-border pt-4">
        <TaskComments :task-id="task.id" />
      </div>

      <!-- Meta -->
      <div class="border-t border-chat-border pt-4 flex gap-6 flex-wrap text-xs text-gray-500">
        <div>
          <span class="uppercase tracking-wide">Created</span>
          <div class="mt-0.5 text-gray-400">{{ formatDatetime(task.created_at) }}</div>
        </div>
        <div>
          <span class="uppercase tracking-wide">Updated</span>
          <div class="mt-0.5 text-gray-400">{{ formatDatetime(task.updated_at) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { TasksApiConflictError, type TaskFieldDefinition, type TaskFieldValue, type TaskTitleConflictResponse } from '@/services/http/tasksApi'
import { useTasksStore } from '@/stores/tasks'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { buildFieldValues, missingRequiredFields } from '@/composables/useTaskFieldValues'
import { useTaskDescriptionCollab, type TaskDescriptionCollabUser } from '@/composables/useTaskDescriptionCollab'
import { renderTaskMarkdownToHtml } from '@/utils/taskMarkdown'
import TaskDescriptionEditor from './TaskDescriptionEditor.vue'
import TaskFieldInput from './TaskFieldInput.vue'
import TaskAttachments from './TaskAttachments.vue'
import TaskComments from './TaskComments.vue'

defineProps<{ templateFilter: string | null }>()
const emit = defineEmits<{ back: [] }>()

const tasksStore = useTasksStore()
const chatStore = useChatStore()
const authStore = useAuthStore()

const titleEditing = ref(false)
const titleSaving = ref(false)
const titleDraft = ref('')
const titleLockToken = ref('')
const reopenTitleEditAfterRefresh = ref(false)
const titleInputRef = ref<HTMLInputElement | null>(null)
const statusSaving = ref(false)
const saveError = ref('')
const viewStatusId = ref('')
const fieldSaving = reactive<Record<string, boolean>>({})
const inlineValues = reactive<Record<string, unknown>>({})
const fieldRequiredErrors = reactive<Record<string, boolean>>({})
const descriptionDraft = ref('')
const descriptionSaving = ref(false)
const descriptionSaveError = ref('')
const lastSavedDescription = ref<string | null>(null)
const hydratingDescription = ref(false)
let descriptionDebounceTimer: ReturnType<typeof setTimeout> | null = null
let descriptionMaxFlushTimer: ReturnType<typeof setTimeout> | null = null
let descriptionRetryTimer: ReturnType<typeof setTimeout> | null = null
let descriptionRetryDelayMs = 1000
const DEBUG_TASK_CARD_DESC = true

const task = computed(() => tasksStore.selectedTask)

const customFields = computed<TaskFieldDefinition[]>(() =>
  task.value ? tasksStore.activeFieldsFor(task.value.template_id) : [],
)

const collabTaskId = computed(() => task.value?.id ?? null)
const collabUser = computed<TaskDescriptionCollabUser | null>(() => {
  const user = authStore.user
  if (!user) return null
  const palette = ['#60a5fa', '#f97316', '#f43f5e', '#22c55e', '#8b5cf6', '#06b6d4', '#eab308', '#14b8a6']
  let hash = 0
  for (let i = 0; i < user.id.length; i += 1) {
    hash = ((hash << 5) - hash) + user.id.charCodeAt(i)
    hash |= 0
  }
  const color = palette[Math.abs(hash) % palette.length]
  return {
    id: user.id,
    name: user.displayName || user.email,
    color,
  }
})
const descriptionCollab = useTaskDescriptionCollab({
  taskId: collabTaskId,
  user: collabUser,
})
const taskDescriptionDoc = computed(() => descriptionCollab.doc.value)
const taskDescriptionProvider = computed(() => descriptionCollab.provider.value)
const taskDescriptionCollabError = computed(() => descriptionCollab.subscribeError.value)
const taskDescriptionAllowLocalDraftSeed = computed(() => descriptionCollab.allowLocalDraftSeed.value)
const descriptionPreviewHtml = computed(() => renderTaskMarkdownToHtml(descriptionDraft.value))

function markdownSignature(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  const preview = input.slice(0, 80).replace(/\n/g, '\\n')
  return `len=${input.length},hash=${hash},preview="${preview}"`
}

function descLog(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_TASK_CARD_DESC) return
  console.debug('[task-card-desc]', event, payload)
}

function isFieldMissing(id: string): boolean {
  return !!fieldRequiredErrors[id]
}

function getStoredValue(field: TaskFieldDefinition): unknown {
  const fv = task.value?.field_values.find(
    (v: TaskFieldValue) => v.field_definition_id === field.id,
  )
  if (!fv) return null
  switch (field.type) {
    case 'text':
    case 'enum':   return fv.value_text
    case 'number': return fv.value_number
    case 'date':   return fv.value_date
    case 'datetime': return fv.value_datetime
    case 'user':   return fv.value_user_id
    case 'users':
    case 'multi_enum': return fv.value_json
    default:       return null
  }
}

function fieldInputValue(field: TaskFieldDefinition): unknown {
  return inlineValues[field.id]
}

function normalizeInlineFieldValue(field: TaskFieldDefinition, value: unknown): unknown {
  if (field.type === 'text' || field.type === 'number' || field.type === 'date') {
    if (value === '' || value === undefined) return null
    return value as string | null
  }
  if (field.type === 'datetime') {
    if (value === '' || value === undefined) return null
    const input = String(value)
    if (input.length === 16) {
      const asDate = new Date(input)
      if (!Number.isNaN(asDate.getTime())) {
        return asDate.toISOString()
      }
    }
    return input
  }
  if (field.type === 'users' || field.type === 'multi_enum') {
    return Array.isArray(value) ? value : []
  }
  if (field.type === 'enum' || field.type === 'user') {
    if (value === '' || value === undefined) return null
    return value as string | null
  }
  return value
}

function isEmptyFieldValue(field: TaskFieldDefinition, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if ((field.type === 'users' || field.type === 'multi_enum') && Array.isArray(value)) {
    return value.length === 0
  }
  return false
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : []
    const bb = Array.isArray(b) ? b : []
    if (aa.length !== bb.length) return false
    return aa.every((v, i) => v === bb[i])
  }
  return a === b
}

function initInlineValues() {
  if (!task.value) return
  customFields.value.forEach(f => {
    inlineValues[f.id] = normalizeInlineFieldValue(f, getStoredValue(f))
  })
}

function buildInlineFieldPayload(field: TaskFieldDefinition, value: unknown): {
  value_text?: string | null
  value_number?: string | null
  value_date?: string | null
  value_datetime?: string | null
  value_user_id?: string | null
  value_json?: unknown | null
  enum_dictionary_id?: string | null
  enum_version?: number | null
} {
  if (field.type === 'text') {
    return { value_text: (value as string | null) ?? null }
  }
  if (field.type === 'number') {
    return { value_number: (value as string | null) ?? null }
  }
  if (field.type === 'date') {
    return { value_date: (value as string | null) ?? null }
  }
  if (field.type === 'datetime') {
    return { value_datetime: (value as string | null) ?? null }
  }
  if (field.type === 'user') {
    return { value_user_id: (value as string | null) ?? null }
  }
  if (field.type === 'users') {
    return { value_json: (value as string[]) ?? [] }
  }
  if (field.type === 'enum') {
    return {
      value_text: (value as string | null) ?? null,
      enum_dictionary_id: field.enum_dictionary_id ?? null,
      enum_version: field.enum_dictionary_id ? (tasksStore.enumVersionFor(field.enum_dictionary_id) ?? null) : null,
    }
  }
  return {
    value_json: (value as string[]) ?? [],
    enum_dictionary_id: field.enum_dictionary_id ?? null,
    enum_version: field.enum_dictionary_id ? (tasksStore.enumVersionFor(field.enum_dictionary_id) ?? null) : null,
  }
}

async function onFieldValueChange(field: TaskFieldDefinition, value: unknown) {
  if (!task.value || fieldSaving[field.id]) return

  const next = normalizeInlineFieldValue(field, value)
  const prev = normalizeInlineFieldValue(field, getStoredValue(field))

  if (field.required && isEmptyFieldValue(field, next)) {
    inlineValues[field.id] = prev
    fieldRequiredErrors[field.id] = true
    return
  }

  fieldRequiredErrors[field.id] = false
  if (valuesEqual(prev, next)) return

  inlineValues[field.id] = next
  fieldSaving[field.id] = true
  saveError.value = ''
  try {
    await tasksStore.updateTaskFieldValue(task.value.id, field.id, buildInlineFieldPayload(field, next))
    inlineValues[field.id] = normalizeInlineFieldValue(field, getStoredValue(field))
  } catch (e) {
    inlineValues[field.id] = prev
    saveError.value = e instanceof Error ? e.message : 'Failed to update field'
  } finally {
    fieldSaving[field.id] = false
  }
}

function isTaskTitleConflictResponse(v: unknown): v is TaskTitleConflictResponse {
  if (!v || typeof v !== 'object') return false
  const rec = v as Record<string, unknown>
  if (!rec.latest || typeof rec.latest !== 'object') return false
  const latest = rec.latest as Record<string, unknown>
  return typeof latest.title === 'string' && typeof latest.updated_at === 'string'
}

async function startTitleEdit() {
  if (!task.value || titleSaving.value) return
  titleDraft.value = task.value.title
  titleLockToken.value = task.value.updated_at
  saveError.value = ''
  titleEditing.value = true
  await nextTick()
  titleInputRef.value?.focus()
  titleInputRef.value?.select()
}

function cancelTitleEdit() {
  if (titleSaving.value) return
  titleEditing.value = false
  titleDraft.value = ''
  titleLockToken.value = ''
  saveError.value = ''
}

async function saveTitle() {
  if (!task.value || !titleEditing.value || titleSaving.value) return
  const title = titleDraft.value.trim()
  if (title === '') {
    saveError.value = 'Title is required'
    return
  }
  if (title === task.value.title) {
    cancelTitleEdit()
    return
  }
  const lockToken = titleLockToken.value || task.value.updated_at
  if (!lockToken) {
    saveError.value = 'Missing optimistic lock token'
    return
  }

  const taskID = task.value.id
  reopenTitleEditAfterRefresh.value = false
  titleSaving.value = true
  saveError.value = ''
  try {
    await tasksStore.updateTaskTitle(taskID, {
      title,
      if_unmodified_since: lockToken,
    })
    titleEditing.value = false
  } catch (e) {
    if (e instanceof TasksApiConflictError && e.status === 409 && isTaskTitleConflictResponse(e.details)) {
      chatStore.showToast('Title changed on server. Loaded latest value.')
      reopenTitleEditAfterRefresh.value = true
      await tasksStore.selectTask(taskID, true)
      titleEditing.value = false
      return
    }
    saveError.value = e instanceof Error ? e.message : 'Failed to update title'
  } finally {
    titleSaving.value = false
  }
}

function normalizeDescription(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function clearDescriptionTimers() {
  if (descriptionDebounceTimer) {
    clearTimeout(descriptionDebounceTimer)
    descriptionDebounceTimer = null
  }
  if (descriptionMaxFlushTimer) {
    clearTimeout(descriptionMaxFlushTimer)
    descriptionMaxFlushTimer = null
  }
}

async function persistDescription(taskID: string, source: string, force = false) {
  const normalized = normalizeDescription(source)
  descLog('persist:start', {
    taskID,
    force,
    source: markdownSignature(source),
    normalized: normalized === null ? 'null' : markdownSignature(normalized),
    lastSaved: lastSavedDescription.value === null ? 'null' : markdownSignature(lastSavedDescription.value),
    isSaving: descriptionSaving.value,
  })
  if (!force && task.value?.id === taskID && normalized === lastSavedDescription.value) {
    descLog('persist:skip-unchanged', { taskID })
    return
  }
  if (descriptionSaving.value) return

  descriptionSaving.value = true
  try {
    await tasksStore.updateTaskDescription(taskID, normalized)
    if (task.value?.id === taskID) {
      lastSavedDescription.value = normalized
      descriptionSaveError.value = ''
      if (descriptionRetryTimer) {
        clearTimeout(descriptionRetryTimer)
        descriptionRetryTimer = null
      }
      descriptionRetryDelayMs = 1000
      descLog('persist:success', {
        taskID,
        saved: normalized === null ? 'null' : markdownSignature(normalized),
      })
    }
  } catch (e) {
    if (task.value?.id === taskID) {
      descriptionSaveError.value = (e instanceof Error ? e.message : 'Failed to save description') + '. Retrying...'
      descLog('persist:error', {
        taskID,
        error: e instanceof Error ? e.message : 'unknown',
        retryDelayMs: descriptionRetryDelayMs,
      })
      if (!descriptionRetryTimer) {
        const retryTaskID = taskID
        descriptionRetryTimer = setTimeout(() => {
          descriptionRetryTimer = null
          descLog('persist:retry-fire', {
            taskID: retryTaskID,
            draft: markdownSignature(descriptionDraft.value),
          })
          void persistDescription(retryTaskID, descriptionDraft.value, true)
          descriptionRetryDelayMs = Math.min(descriptionRetryDelayMs * 2, 15000)
        }, descriptionRetryDelayMs)
      }
    }
  } finally {
    descriptionSaving.value = false
  }
}

function scheduleDescriptionAutosave() {
  if (!task.value) return
  const taskID = task.value.id
  descLog('autosave:schedule', {
    taskID,
    draft: markdownSignature(descriptionDraft.value),
  })
  if (descriptionDebounceTimer) {
    clearTimeout(descriptionDebounceTimer)
  }
  descriptionDebounceTimer = setTimeout(() => {
    descriptionDebounceTimer = null
    void persistDescription(taskID, descriptionDraft.value)
  }, 800)

  if (!descriptionMaxFlushTimer) {
    descriptionMaxFlushTimer = setTimeout(() => {
      descriptionMaxFlushTimer = null
      if (descriptionDebounceTimer) {
        clearTimeout(descriptionDebounceTimer)
        descriptionDebounceTimer = null
      }
      void persistDescription(taskID, descriptionDraft.value, true)
    }, 10_000)
  }
}

function flushDescriptionNow() {
  if (!task.value) return
  descLog('autosave:flushNow', {
    taskID: task.value.id,
    draft: markdownSignature(descriptionDraft.value),
  })
  clearDescriptionTimers()
  void persistDescription(task.value.id, descriptionDraft.value, true)
}

async function onViewStatusChange() {
  if (!task.value || statusSaving.value) return
  const prev = task.value.status_id
  const next = viewStatusId.value
  if (!next || next === prev) return
  statusSaving.value = true
  saveError.value = ''
  try {
    await tasksStore.updateTaskStatus(task.value.id, next)
    viewStatusId.value = next
  } catch (e) {
    viewStatusId.value = prev
    saveError.value = e instanceof Error ? e.message : 'Failed to update status'
  } finally {
    statusSaving.value = false
  }
}

// ---- Subtask form ----
const showSubtaskForm = ref(false)
const subtaskSaving = ref(false)
const subtaskError = ref('')
const showSubtaskValidation = ref(false)

const subtaskForm = reactive({ templateId: '', title: '', description: '', statusId: '' })
const subtaskCustomValues = reactive<Record<string, unknown>>({})

const subtaskFields = computed<TaskFieldDefinition[]>(() =>
  subtaskForm.templateId ? tasksStore.activeFieldsFor(subtaskForm.templateId) : [],
)

const subtaskMissingFields = computed(() =>
  missingRequiredFields(subtaskFields.value, subtaskCustomValues),
)

const canSubmitSubtask = computed(() =>
  !!subtaskForm.templateId &&
  subtaskForm.title.trim() !== '' &&
  subtaskForm.statusId !== '' &&
  subtaskMissingFields.value.length === 0,
)

function isSubtaskFieldMissing(id: string): boolean {
  return showSubtaskValidation.value && subtaskMissingFields.value.includes(id)
}

async function openSubtaskForm() {
  // Ensure config is loaded so templates/statuses are available
  await tasksStore.loadConfig()
  subtaskForm.templateId = tasksStore.activeTemplates[0]?.id ?? ''
  subtaskForm.title = ''
  subtaskForm.description = ''
  subtaskForm.statusId = tasksStore.activeStatuses[0]?.id ?? ''
  Object.keys(subtaskCustomValues).forEach(k => delete subtaskCustomValues[k])
  subtaskError.value = ''
  showSubtaskValidation.value = false
  showSubtaskForm.value = true
  if (subtaskForm.templateId) {
    await tasksStore.loadFieldsFor(subtaskForm.templateId)
    preloadSubtaskSupportingData()
  }
}

function cancelSubtaskForm() {
  showSubtaskForm.value = false
  subtaskError.value = ''
  showSubtaskValidation.value = false
}

async function selectSubtaskTemplate(id: string) {
  if (subtaskForm.templateId === id) return
  subtaskForm.templateId = id
  Object.keys(subtaskCustomValues).forEach(k => delete subtaskCustomValues[k])
  await tasksStore.loadFieldsFor(id)
  preloadSubtaskSupportingData()
}

function preloadSubtaskSupportingData() {
  if (subtaskFields.value.some(f => f.type === 'user' || f.type === 'users')) {
    tasksStore.loadUsers()
  }
  subtaskFields.value
    .filter(f => (f.type === 'enum' || f.type === 'multi_enum') && f.enum_dictionary_id)
    .forEach(f => tasksStore.loadEnumItemsFor(f.enum_dictionary_id!))
}

async function submitSubtask() {
  showSubtaskValidation.value = true
  if (!task.value || !canSubmitSubtask.value || subtaskSaving.value) return
  subtaskSaving.value = true
  subtaskError.value = ''
  try {
    await tasksStore.createSubtask(task.value.id, {
      template_id: subtaskForm.templateId,
      title: subtaskForm.title.trim(),
      description: subtaskForm.description.trim() || null,
      status_id: subtaskForm.statusId,
      field_values: buildFieldValues(subtaskFields.value, subtaskCustomValues, tasksStore.enumVersionFor),
    })
    showSubtaskForm.value = false
    showSubtaskValidation.value = false
  } catch (e) {
    subtaskError.value = e instanceof Error ? e.message : 'Failed to create subtask'
  } finally {
    subtaskSaving.value = false
  }
}

function formatDatetime(v: string): string {
  return v ? new Date(v).toLocaleString() : ''
}

function handleBeforeUnload() {
  if (!task.value) return
  clearDescriptionTimers()
  void persistDescription(task.value.id, descriptionDraft.value, true)
}

watch(() => task.value?.id, (_nextTaskID, prevTaskID) => {
  descLog('watch:taskId', {
    prevTaskID,
    nextTaskID: task.value?.id ?? null,
    selectedDescription: task.value?.description ? markdownSignature(task.value.description) : 'null',
  })
  if (prevTaskID) {
    clearDescriptionTimers()
    void persistDescription(prevTaskID, descriptionDraft.value, true)
  }

  Object.keys(inlineValues).forEach(k => delete inlineValues[k])
  Object.keys(fieldSaving).forEach(k => delete fieldSaving[k])
  Object.keys(fieldRequiredErrors).forEach(k => delete fieldRequiredErrors[k])
  initInlineValues()
  if (customFields.value.some(f => f.type === 'user' || f.type === 'users')) {
    tasksStore.loadUsers()
  }
  customFields.value
    .filter(f => (f.type === 'enum' || f.type === 'multi_enum') && f.enum_dictionary_id)
    .forEach(f => tasksStore.loadEnumItemsFor(f.enum_dictionary_id!))
  viewStatusId.value = task.value?.status_id ?? ''
  hydratingDescription.value = true
  descriptionDraft.value = task.value?.description ?? ''
  lastSavedDescription.value = normalizeDescription(descriptionDraft.value)
  hydratingDescription.value = false
  titleEditing.value = false
  titleSaving.value = false
  titleDraft.value = ''
  titleLockToken.value = ''
  saveError.value = ''
  descriptionSaveError.value = ''
  descriptionRetryDelayMs = 1000
  showSubtaskForm.value = false
  subtaskError.value = ''
  showSubtaskValidation.value = false
  if (reopenTitleEditAfterRefresh.value && task.value) {
    reopenTitleEditAfterRefresh.value = false
    void startTitleEdit()
  }
}, { immediate: true })

watch(() => descriptionCollab.serverMarkdown.value, (next) => {
  if (next === null) return
  descLog('watch:serverMarkdown', {
    taskID: task.value?.id ?? null,
    next: markdownSignature(next),
    currentDraft: markdownSignature(descriptionDraft.value),
  })
  hydratingDescription.value = true
  descriptionDraft.value = next
  lastSavedDescription.value = normalizeDescription(next)
  hydratingDescription.value = false
  descriptionCollab.serverMarkdown.value = null
})

watch(descriptionDraft, () => {
  descLog('watch:descriptionDraft', {
    taskID: task.value?.id ?? null,
    hydrating: hydratingDescription.value,
    draft: markdownSignature(descriptionDraft.value),
  })
  if (hydratingDescription.value || !task.value) return
  scheduleDescriptionAutosave()
}, { flush: 'sync' })

watch(customFields, () => {
  initInlineValues()
  if (customFields.value.some(f => f.type === 'user' || f.type === 'users')) {
    tasksStore.loadUsers()
  }
  customFields.value
    .filter(f => (f.type === 'enum' || f.type === 'multi_enum') && f.enum_dictionary_id)
    .forEach(f => tasksStore.loadEnumItemsFor(f.enum_dictionary_id!))
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  if (task.value) {
    clearDescriptionTimers()
    void persistDescription(task.value.id, descriptionDraft.value, true)
  }
})
</script>

<style scoped>
.field-label {
  @apply text-xs text-gray-500 uppercase tracking-wide mb-1;
}
.form-label {
  @apply block text-xs text-gray-400 mb-1;
}
.field-select {
  @apply bg-chat-input border border-chat-border rounded px-2 py-1 text-white text-sm outline-none focus:border-accent;
}
.btn-primary {
  @apply px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed;
}
.btn-secondary {
  @apply px-3 py-1.5 rounded border border-chat-border text-gray-300 hover:text-white hover:border-accent/60 transition-colors disabled:opacity-50;
}
</style>
