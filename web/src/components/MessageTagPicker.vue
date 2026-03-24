<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed z-[10020] w-[360px] overflow-hidden rounded-xl border border-chat-border bg-chat-header shadow-2xl"
      :style="style"
      @mousedown.prevent
    >
      <div class="border-b border-chat-border px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-gray-400">
        Tag search
      </div>
      <div v-if="loading" class="px-3 py-3 text-sm text-gray-400">Searching...</div>
      <div v-else-if="error" class="px-3 py-3 text-sm text-red-300">{{ error }}</div>
      <div v-else class="max-h-80 overflow-y-auto py-1">
        <template v-if="flatItems.length === 0">
          <div class="px-3 py-3 text-sm text-gray-400">No matches</div>
        </template>
        <template v-else>
          <section v-for="group in groups" :key="group.key" class="py-1">
            <div class="px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-gray-500">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="`${group.key}-${item.id}`"
              class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
              :class="item.flatIndex === selectedIndex ? 'bg-white/10 text-white' : 'text-gray-200 hover:bg-white/5'"
              @click="$emit('select', item)"
            >
              <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-sm">{{ item.icon }}</span>
              <div class="min-w-0">
                <div class="truncate text-sm">{{ item.label }}</div>
                <div class="truncate text-xs text-gray-500">{{ item.subtitle }}</div>
              </div>
            </button>
          </section>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface MessageTagPickerItem {
  kind: 'user' | 'task' | 'document'
  id: string
  label: string
  subtitle: string
  href: string
  icon: string
  flatIndex: number
  meta?: Record<string, string>
}

const props = defineProps<{
  open: boolean
  loading: boolean
  error: string
  style: Record<string, string>
  selectedIndex: number
  users: MessageTagPickerItem[]
  tasks: MessageTagPickerItem[]
  documents: MessageTagPickerItem[]
}>()

defineEmits<{
  select: [item: MessageTagPickerItem]
}>()

const groups = computed(() => [
  { key: 'users', label: 'Users', items: props.users },
  { key: 'tasks', label: 'Tasks', items: props.tasks },
  { key: 'documents', label: 'Documents', items: props.documents },
].filter(group => group.items.length > 0))

const flatItems = computed(() => [...props.users, ...props.tasks, ...props.documents])
</script>
