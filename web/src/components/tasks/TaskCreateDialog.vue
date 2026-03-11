<template>
  <Teleport to="body">
    <div
      v-if="tasksStore.createDialogOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="close"
    >
      <div class="w-full max-w-lg rounded-xl border border-chat-border bg-chat-header shadow-2xl flex flex-col max-h-[90vh]">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-chat-border shrink-0">
          <h2 class="text-base font-semibold text-white">New task</h2>
          <button
            class="text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Close"
            @click="close"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="overflow-y-auto px-6 py-4 space-y-4">
          <div v-if="tasksStore.configError" class="text-red-400 text-sm">
            {{ tasksStore.configError }}
          </div>

          <div v-else-if="tasksStore.configLoading" class="text-gray-400 text-sm">
            Loading...
          </div>

          <div v-else-if="tasksStore.activeTemplates.length === 0" class="text-gray-400 text-sm">
            No active templates. Ask an administrator to create one.
          </div>

          <template v-else>
            <!-- Template selector -->
            <div>
              <label class="form-label">Template</label>
              <div class="flex gap-2 flex-wrap">
                <button
                  v-for="tpl in tasksStore.activeTemplates"
                  :key="tpl.id"
                  type="button"
                  class="px-3 py-1 rounded text-sm border transition-colors"
                  :class="selectedTemplateId === tpl.id
                    ? 'bg-accent border-accent text-white'
                    : 'border-chat-border text-gray-300 hover:border-accent/60 hover:text-white'"
                  @click="selectTemplate(tpl.id)"
                >
                  {{ tpl.prefix }}
                </button>
              </div>
            </div>

            <!-- System fields -->
            <div>
              <label class="form-label">Title <span class="text-red-400">*</span></label>
              <input
                v-model="form.title"
                type="text"
                class="form-input"
                placeholder="Task title"
                autofocus
              />
            </div>

            <div>
              <label class="form-label">Description</label>
              <textarea
                v-model="form.description"
                class="form-input min-h-[80px] resize-y"
                placeholder="Optional description"
              />
            </div>

            <div>
              <label class="form-label">Status <span class="text-red-400">*</span></label>
              <select v-model="form.statusId" class="form-input">
                <option value="">— select status —</option>
                <option v-for="s in tasksStore.activeStatuses" :key="s.id" :value="s.id">
                  {{ s.name }}
                </option>
              </select>
            </div>

            <!-- Custom fields -->
            <template v-for="field in activeFields" :key="field.id">
              <div>
                <label
                  class="form-label"
                  :class="isFieldMissing(field.id) ? 'text-red-400' : ''"
                >
                  {{ field.name }}
                  <span v-if="field.required" class="text-red-400">*</span>
                </label>
                <TaskFieldInput
                  :field="field"
                  :value="customValues[field.id]"
                  mode="edit"
                  :users="tasksStore.users"
                  :enum-items="field.enum_dictionary_id ? tasksStore.enumItemsFor(field.enum_dictionary_id) : undefined"
                  @update:value="customValues[field.id] = $event"
                />
                <p v-if="isFieldMissing(field.id)" class="text-red-400 text-xs mt-1">
                  This field is required
                </p>
              </div>
            </template>
          </template>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-3 px-6 py-4 border-t border-chat-border shrink-0">
          <div v-if="submitError" class="flex-1 text-red-400 text-sm self-center">
            {{ submitError }}
          </div>
          <button
            type="button"
            class="px-4 py-2 rounded text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
            :disabled="submitting"
            @click="close"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!canSubmit || submitting"
            @click="submit"
          >
            {{ submitting ? 'Creating...' : 'Create task' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import type { TaskFieldDefinition } from '@/services/http/tasksApi'
import { buildFieldValues, missingRequiredFields } from '@/composables/useTaskFieldValues'
import TaskFieldInput from './TaskFieldInput.vue'

const tasksStore = useTasksStore()

const selectedTemplateId = ref<string>('')
const submitting = ref(false)
const submitError = ref('')
const showValidation = ref(false)

const form = reactive({
  title: '',
  description: '',
  statusId: '',
})

const customValues = reactive<Record<string, unknown>>({})

const activeFields = computed<TaskFieldDefinition[]>(() =>
  selectedTemplateId.value ? tasksStore.activeFieldsFor(selectedTemplateId.value) : [],
)

const missingFields = computed(() =>
  missingRequiredFields(activeFields.value, customValues),
)

const canSubmit = computed(() =>
  !!selectedTemplateId.value &&
  form.title.trim() !== '' &&
  form.statusId !== '' &&
  tasksStore.activeTemplates.length > 0 &&
  missingFields.value.length === 0,
)

function isFieldMissing(id: string): boolean {
  return showValidation.value && missingFields.value.includes(id)
}

async function selectTemplate(id: string) {
  if (selectedTemplateId.value === id) return
  selectedTemplateId.value = id
  Object.keys(customValues).forEach(k => delete customValues[k])
  await tasksStore.loadFieldsFor(id)
  preloadSupportingData()
}

function preloadSupportingData() {
  // Load users once if any user/users field exists
  if (activeFields.value.some(f => f.type === 'user' || f.type === 'users')) {
    tasksStore.loadUsers()
  }
  // Load enum items for each enum field
  activeFields.value
    .filter(f => (f.type === 'enum' || f.type === 'multi_enum') && f.enum_dictionary_id)
    .forEach(f => tasksStore.loadEnumItemsFor(f.enum_dictionary_id!))
}

function close() {
  if (submitting.value) return
  tasksStore.closeCreateDialog()
}

function reset() {
  form.title = ''
  form.description = ''
  form.statusId = tasksStore.activeStatuses[0]?.id ?? ''
  Object.keys(customValues).forEach(k => delete customValues[k])
  submitError.value = ''
  showValidation.value = false
  selectedTemplateId.value = tasksStore.activeTemplates[0]?.id ?? ''
}

async function submit() {
  showValidation.value = true
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  submitError.value = ''
  try {
    await tasksStore.createTask({
      template_id: selectedTemplateId.value,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status_id: form.statusId,
      field_values: buildFieldValues(activeFields.value, customValues, tasksStore.enumVersionFor),
    })
    tasksStore.closeCreateDialog()
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : 'Failed to create task'
  } finally {
    submitting.value = false
  }
}

// Initialise when dialog opens; reset when it closes
watch(() => tasksStore.createDialogOpen, async (open) => {
  if (!open) {
    reset()
    return
  }
  await tasksStore.loadConfig()
  // Set defaults after config is loaded
  selectedTemplateId.value = tasksStore.activeTemplates[0]?.id ?? ''
  form.statusId = tasksStore.activeStatuses[0]?.id ?? ''
  if (selectedTemplateId.value) {
    await tasksStore.loadFieldsFor(selectedTemplateId.value)
    preloadSupportingData()
  }
})
</script>

<style scoped>
.form-label {
  @apply block text-sm text-gray-400 mb-1;
}
.form-input {
  @apply w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent transition-colors;
}
</style>
