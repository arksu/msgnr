<template>
  <div ref="root" class="relative">
    <!-- Trigger -->
    <button
      type="button"
      class="multiselect-trigger"
      :class="open ? 'border-accent' : ''"
      @click="toggle"
    >
      <!-- Pills for selected items -->
      <span v-if="selected.length === 0" class="text-gray-500 text-sm">{{ placeholder }}</span>
      <span v-else class="flex flex-wrap gap-1">
        <span
          v-for="item in selected"
          :key="item.value"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/20 text-accent text-xs"
        >
          <UserAvatar
            v-if="item.avatarUrl || item.userId"
            :user-id="item.userId || item.value"
            :display-name="item.label"
            :avatar-url="item.avatarUrl"
            size="xs"
            :presence="item.presence"
          />
          {{ item.label }}
          <button
            type="button"
            class="hover:text-white leading-none"
            @click.stop="deselect(item.value)"
          >
            ×
          </button>
        </span>
      </span>
      <!-- Chevron -->
      <svg
        class="ml-auto shrink-0 w-3.5 h-3.5 text-gray-500 transition-transform"
        :class="open ? 'rotate-180' : ''"
        fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
      >
        <path d="m6 9 6 6 6-6"/>
      </svg>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute z-50 mt-1 w-full rounded border border-chat-border bg-chat-header shadow-xl"
    >
      <!-- Search -->
      <div class="p-2 border-b border-chat-border">
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          class="w-full bg-chat-input border border-chat-border rounded px-2 py-1 text-white text-sm outline-none focus:border-accent"
          placeholder="Search..."
        />
      </div>

      <!-- Options -->
      <ul class="max-h-48 overflow-y-auto py-1">
        <li v-if="filtered.length === 0" class="px-3 py-2 text-sm text-gray-500">
          No results
        </li>
        <li
          v-for="item in filtered"
          :key="item.value"
          class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
          @click="toggle(item.value)"
        >
          <span
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors"
            :class="isSelected(item.value)
              ? 'border-accent bg-accent'
              : 'border-chat-border'"
          >
            <svg
              v-if="isSelected(item.value)"
              class="w-2.5 h-2.5 text-white"
              fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"
            >
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          </span>
          <UserAvatar
            v-if="item.avatarUrl || item.userId"
            :user-id="item.userId || item.value"
            :display-name="item.label"
            :avatar-url="item.avatarUrl"
            size="xs"
            :presence="item.presence"
          />
          <span class="text-sm text-gray-200 truncate">{{ item.label }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onUnmounted } from 'vue'
import UserAvatar from '@/components/UserAvatar.vue'

interface Option {
  value: string
  label: string
  userId?: string
  avatarUrl?: string
  presence?: 'online' | 'away' | 'offline'
}

const props = defineProps<{
  options: Option[]
  modelValue: string[]
  placeholder?: string
  single?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const root = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const open = ref(false)
const query = ref('')

const selected = computed<Option[]>(() =>
  props.modelValue
    .map(v => props.options.find(o => o.value === v))
    .filter((o): o is Option => o !== undefined),
)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? props.options.filter(o => o.label.toLowerCase().includes(q)) : props.options
})

function isSelected(value: string): boolean {
  return props.modelValue.includes(value)
}

function toggle(valueOrEvent?: string | MouseEvent) {
  // Called both as a click handler on the trigger (no arg / MouseEvent) and
  // as a list item handler (string arg).
  if (typeof valueOrEvent === 'string') {
    let next: string[]
    if (props.single) {
      next = isSelected(valueOrEvent) ? [] : [valueOrEvent]
      open.value = false
    } else {
      next = isSelected(valueOrEvent)
        ? props.modelValue.filter(v => v !== valueOrEvent)
        : [...props.modelValue, valueOrEvent]
    }
    emit('update:modelValue', next)
  } else {
    open.value = !open.value
    if (open.value) {
      query.value = ''
      nextTick(() => searchInput.value?.focus())
    }
  }
}

function deselect(value: string) {
  emit('update:modelValue', props.modelValue.filter(v => v !== value))
}

// Close on outside click
function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<style scoped>
.multiselect-trigger {
  @apply w-full flex flex-wrap items-center gap-1 min-h-[34px] bg-chat-input border border-chat-border rounded px-3 py-1.5 text-left outline-none transition-colors cursor-pointer hover:border-accent/60;
}
</style>
