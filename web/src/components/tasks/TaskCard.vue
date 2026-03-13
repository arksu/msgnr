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
          v-if="editing"
          v-model="form.title"
          type="text"
          class="flex-1 min-w-0 bg-chat-input border border-chat-border rounded px-3 py-1 text-white text-sm outline-none focus:border-accent"
          placeholder="Task title"
        />
        <h1 v-else class="text-base font-semibold text-white truncate">{{ task.title }}</h1>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <template v-if="editing">
          <button class="btn-secondary text-sm" :disabled="saving" @click="cancelEdit">Cancel</button>
          <button
            class="btn-primary text-sm"
            :disabled="!canSave || saving"
            @click="save"
          >
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </template>
        <button v-else class="btn-secondary text-sm" @click="startEdit">Edit</button>
      </div>
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
          <span v-if="editing" class="text-sm text-gray-200">
            {{ tasksStore.statusById(task.status_id)?.name ?? task.status_id }}
          </span>
          <select
            v-else
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

      <!-- Description -->
      <div>
        <div class="field-label flex items-center justify-between gap-2">
          <span>Description</span>
          <div v-if="!editing" class="inline-flex rounded border border-chat-border overflow-hidden text-[11px] normal-case tracking-normal">
            <button
              type="button"
              class="px-2 py-0.5"
              :class="tasksStore.descriptionViewMode === 'rendered' ? 'bg-accent text-white' : 'bg-chat-input text-gray-300 hover:text-white'"
              @click="tasksStore.descriptionViewMode = 'rendered'"
            >
              Rendered
            </button>
            <button
              type="button"
              class="px-2 py-0.5 border-l border-chat-border"
              :class="tasksStore.descriptionViewMode === 'raw' ? 'bg-accent text-white' : 'bg-chat-input text-gray-300 hover:text-white'"
              @click="tasksStore.descriptionViewMode = 'raw'"
            >
              Raw
            </button>
          </div>
        </div>
        <textarea
          v-if="editing"
          v-model="form.description"
          class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent resize-y min-h-[80px]"
          placeholder="Description"
        />
        <div
          v-else-if="task.description && tasksStore.descriptionViewMode === 'rendered'"
          class="markdown-body text-sm text-gray-200"
          v-html="renderedDescriptionHtml"
        />
        <p v-else-if="task.description" class="text-sm text-gray-200 whitespace-pre-wrap">
          {{ task.description }}
        </p>
        <span v-else class="text-sm text-gray-500 italic">—</span>
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
            :mode="fieldInputMode(field)"
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
            <textarea
              v-model="subtaskForm.description"
              class="w-full bg-chat-bg border border-chat-border rounded px-3 py-1.5 text-white text-sm outline-none focus:border-accent resize-y min-h-[60px] transition-colors"
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
import { computed, reactive, ref, watch } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import type { TaskFieldDefinition, TaskFieldValue } from '@/services/http/tasksApi'
import { buildFieldValues, missingRequiredFields } from '@/composables/useTaskFieldValues'
import { renderMarkdownToHtml } from '@/utils/markdown'
import TaskFieldInput from './TaskFieldInput.vue'
import TaskAttachments from './TaskAttachments.vue'
import TaskComments from './TaskComments.vue'

defineProps<{ templateFilter: string | null }>()
const emit = defineEmits<{ back: [] }>()

const tasksStore = useTasksStore()

// ---- Edit mode ----
const editing = ref(false)
const saving = ref(false)
const statusSaving = ref(false)
const saveError = ref('')
const showValidation = ref(false)
const viewStatusId = ref('')
const fieldSaving = reactive<Record<string, boolean>>({})
const inlineValues = reactive<Record<string, unknown>>({})

const form = reactive({ title: '', description: '', statusId: '' })
const customValues = reactive<Record<string, unknown>>({})

const task = computed(() => tasksStore.selectedTask)

const customFields = computed<TaskFieldDefinition[]>(() =>
  task.value ? tasksStore.activeFieldsFor(task.value.template_id) : [],
)

const missingFields = computed(() =>
  missingRequiredFields(customFields.value, customValues),
)

const canSave = computed(() =>
  form.title.trim() !== '' &&
  form.statusId !== '' &&
  missingFields.value.length === 0,
)

const renderedDescriptionHtml = computed(() => {
  const src = task.value?.description ?? ''
  if (!src) return ''
  return renderMarkdownToHtml(src)
})

function isFieldMissing(id: string): boolean {
  return showValidation.value && missingFields.value.includes(id)
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

function isInlineEditableField(field: TaskFieldDefinition): boolean {
  return field.type === 'enum' || field.type === 'multi_enum' || field.type === 'user' || field.type === 'users'
}

function fieldInputMode(field: TaskFieldDefinition): 'view' | 'edit' {
  if (editing.value) return 'edit'
  return isInlineEditableField(field) ? 'edit' : 'view'
}

function fieldInputValue(field: TaskFieldDefinition): unknown {
  if (editing.value) return customValues[field.id]
  if (isInlineEditableField(field)) return inlineValues[field.id]
  return getStoredValue(field)
}

function normalizeInlineFieldValue(field: TaskFieldDefinition, value: unknown): unknown {
  if (field.type === 'users' || field.type === 'multi_enum') {
    return Array.isArray(value) ? value : []
  }
  if (field.type === 'enum' || field.type === 'user') {
    if (value === '' || value === undefined) return null
    return value as string | null
  }
  return value
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
    if (isInlineEditableField(f)) {
      inlineValues[f.id] = normalizeInlineFieldValue(f, getStoredValue(f))
    }
  })
}

function buildInlineFieldPayload(field: TaskFieldDefinition, value: unknown): {
  value_text?: string | null
  value_user_id?: string | null
  value_json?: unknown | null
  enum_dictionary_id?: string | null
  enum_version?: number | null
} {
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
  if (editing.value) {
    customValues[field.id] = value
    return
  }
  if (!task.value || !isInlineEditableField(field) || fieldSaving[field.id]) return

  const next = normalizeInlineFieldValue(field, value)
  const prev = normalizeInlineFieldValue(field, getStoredValue(field))
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

function startEdit() {
  if (!task.value) return
  form.title = task.value.title
  form.description = task.value.description ?? ''
  form.statusId = task.value.status_id
  customFields.value.forEach(f => { customValues[f.id] = getStoredValue(f) })
  saveError.value = ''
  showValidation.value = false
  editing.value = true

  // Preload supporting data for edit inputs
  if (customFields.value.some(f => f.type === 'user' || f.type === 'users')) {
    tasksStore.loadUsers()
  }
  customFields.value
    .filter(f => (f.type === 'enum' || f.type === 'multi_enum') && f.enum_dictionary_id)
    .forEach(f => tasksStore.loadEnumItemsFor(f.enum_dictionary_id!))
}

function cancelEdit() {
  editing.value = false
  saveError.value = ''
  showValidation.value = false
}

async function save() {
  showValidation.value = true
  if (!task.value || !canSave.value || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    await tasksStore.updateTask(task.value.id, {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status_id: form.statusId,
      field_values: buildFieldValues(customFields.value, customValues, tasksStore.enumVersionFor),
    })
    editing.value = false
    showValidation.value = false
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save task'
  } finally {
    saving.value = false
  }
}

async function onViewStatusChange() {
  if (!task.value || editing.value || statusSaving.value) return
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

// Exit edit mode and close subtask form when task changes
watch(task, () => {
  Object.keys(inlineValues).forEach(k => delete inlineValues[k])
  Object.keys(fieldSaving).forEach(k => delete fieldSaving[k])
  initInlineValues()
  if (customFields.value.some(f => f.type === 'user' || f.type === 'users')) {
    tasksStore.loadUsers()
  }
  customFields.value
    .filter(f => (f.type === 'enum' || f.type === 'multi_enum') && f.enum_dictionary_id)
    .forEach(f => tasksStore.loadEnumItemsFor(f.enum_dictionary_id!))
  viewStatusId.value = task.value?.status_id ?? ''
  editing.value = false
  saveError.value = ''
  showValidation.value = false
  showSubtaskForm.value = false
  subtaskError.value = ''
  showSubtaskValidation.value = false
}, { immediate: true })

watch(customFields, () => {
  initInlineValues()
  if (customFields.value.some(f => f.type === 'user' || f.type === 'users')) {
    tasksStore.loadUsers()
  }
  customFields.value
    .filter(f => (f.type === 'enum' || f.type === 'multi_enum') && f.enum_dictionary_id)
    .forEach(f => tasksStore.loadEnumItemsFor(f.enum_dictionary_id!))
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
