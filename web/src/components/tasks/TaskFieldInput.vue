<template>
  <!-- View mode -->
  <template v-if="mode === 'view'">
    <span v-if="isEmpty" class="text-gray-500 italic text-sm">—</span>

    <span v-else-if="field.type === 'text'" class="text-sm text-gray-200 whitespace-pre-wrap">{{ value }}</span>

    <span v-else-if="field.type === 'number'" class="text-sm text-gray-200">{{ value }}</span>

    <span v-else-if="field.type === 'date'" class="text-sm text-gray-200">{{ formatDate(value as string) }}</span>

    <span v-else-if="field.type === 'datetime'" class="text-sm text-gray-200">{{ formatDatetime(value as string) }}</span>

    <span v-else-if="field.type === 'user'" class="inline-flex items-center gap-2 text-sm text-gray-200">
      <UserAvatar
        :user-id="(value as string) || ''"
        :display-name="resolveUser(value as string)"
        :avatar-url="resolveUserAvatar(value as string)"
        size="xs"
      />
      <span>{{ resolveUser(value as string) }}</span>
    </span>

    <span v-else-if="field.type === 'users'" class="inline-flex flex-wrap gap-2 text-sm text-gray-200">
      <span v-for="userId in ((value as string[]) ?? [])" :key="userId" class="inline-flex items-center gap-1">
        <UserAvatar
          :user-id="userId"
          :display-name="resolveUser(userId)"
          :avatar-url="resolveUserAvatar(userId)"
          size="xs"
        />
        <span>{{ resolveUser(userId) }}</span>
      </span>
    </span>

    <span v-else-if="field.type === 'enum'" class="text-sm text-gray-200">{{ resolveEnumLabel(value as string) }}</span>

    <span v-else-if="field.type === 'multi_enum'" class="text-sm text-gray-200">
      {{ (value as string[]).map(resolveEnumLabel).join(', ') }}
    </span>
  </template>

  <!-- Edit mode -->
  <template v-else>
    <input
      v-if="field.type === 'text'"
      :value="value as string"
      type="text"
      class="field-input"
      :placeholder="field.name"
      @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    />

    <input
      v-else-if="field.type === 'number'"
      :value="value as string"
      type="number"
      class="field-input"
      :placeholder="field.name"
      @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    />

    <input
      v-else-if="field.type === 'date'"
      :value="value as string"
      type="date"
      class="field-input"
      @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    />

    <input
      v-else-if="field.type === 'datetime'"
      :value="value as string"
      type="datetime-local"
      class="field-input"
      @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    />

    <MultiSelect
      v-else-if="field.type === 'user'"
      :model-value="(value ? [value as string] : [])"
      :options="userOptions"
      placeholder="— select user —"
      single
      @update:model-value="emit('update:value', $event[0] || null)"
    />

    <MultiSelect
      v-else-if="field.type === 'users'"
      :model-value="(value as string[] | null) ?? []"
      :options="userOptions"
      placeholder="— select users —"
      @update:model-value="emit('update:value', $event)"
    />

    <select
      v-else-if="field.type === 'enum'"
      :value="value as string"
      class="field-input"
      @change="emit('update:value', ($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">— none —</option>
      <option v-for="item in activeEnumItems" :key="item.value_code" :value="item.value_code">
        {{ item.value_name }}
      </option>
    </select>

    <MultiSelect
      v-else-if="field.type === 'multi_enum'"
      :model-value="(value as string[] | null) ?? []"
      :options="activeEnumItems.map(i => ({ value: i.value_code, label: i.value_name }))"
      placeholder="— select values —"
      @update:model-value="emit('update:value', $event)"
    />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TaskFieldDefinition, TaskUser, EnumDictionaryVersionItem } from '@/services/http/tasksApi'
import MultiSelect from './MultiSelect.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const props = defineProps<{
  field: TaskFieldDefinition
  value: unknown
  mode: 'view' | 'edit'
  /** Injected from the store — only required for user/users field types */
  users?: TaskUser[]
  /** Injected from the store — only required for enum/multi_enum field types */
  enumItems?: EnumDictionaryVersionItem[]
}>()

const emit = defineEmits<{
  'update:value': [value: unknown]
}>()

const isEmpty = computed(() => {
  const v = props.value
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
})

// ---- Users ----
const userOptions = computed(() =>
  (props.users ?? []).map(u => ({
    value: u.id,
    label: u.display_name || u.email,
    userId: u.id,
    avatarUrl: u.avatar_url,
  })),
)

function resolveUser(id: string): string {
  const u = props.users?.find(u => u.id === id)
  return u ? (u.display_name || u.email) : id
}

function resolveUserAvatar(id: string): string {
  const u = props.users?.find(u => u.id === id)
  return u?.avatar_url ?? ''
}

// ---- Enum ----
const activeEnumItems = computed(() =>
  (props.enumItems ?? []).filter(i => i.is_active),
)

function resolveEnumLabel(code: string): string {
  const item = props.enumItems?.find(i => i.value_code === code)
  return item ? item.value_name : code
}

// ---- Formatters ----
function formatDate(v: string): string {
  return v ? new Date(v).toLocaleDateString() : ''
}

function formatDatetime(v: string): string {
  return v ? new Date(v).toLocaleString() : ''
}
</script>

<style scoped>
.field-input {
  @apply w-full bg-chat-input border border-chat-border rounded px-3 py-1.5 text-white text-sm outline-none focus:border-accent transition-colors;
}
</style>
