<template>
  <aside class="flex flex-col h-full w-60 min-w-[240px] bg-sidebar-bg select-none border-r border-white/10">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <span class="font-bold text-white text-[15px]">Tasks</span>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto py-3 px-2">
      <!-- New Task button -->
      <button
        class="w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors mb-3"
        @click="tasksStore.openCreateDialog"
      >
        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        New task
      </button>

      <div v-if="tasksStore.configLoading" class="px-3 py-2 text-xs text-gray-500">
        Loading...
      </div>

      <div v-else-if="tasksStore.configError" class="px-3 py-2 text-xs text-red-400">
        {{ tasksStore.configError }}
      </div>

      <template v-else-if="tasksStore.activeTemplates.length > 0">
        <div class="px-3 py-1 text-xs font-semibold text-sidebar-heading uppercase tracking-wide">
          Templates
        </div>

        <button
          class="sidebar-item"
          :class="modelValue === null ? 'bg-sidebar-active text-white' : ''"
          @click="emit('update:modelValue', null)"
        >
          <svg class="w-4 h-4 shrink-0 text-sidebar-heading" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
          </svg>
          All tasks
        </button>

        <button
          v-for="tpl in tasksStore.activeTemplates"
          :key="tpl.id"
          class="sidebar-item"
          :class="modelValue === tpl.id ? 'bg-sidebar-active text-white' : ''"
          @click="emit('update:modelValue', tpl.id)"
        >
          <svg class="w-4 h-4 shrink-0 text-sidebar-heading" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M9 11 11 13 15 9"/>
            <rect x="4" y="4" width="16" height="16" rx="2"/>
          </svg>
          <span class="font-mono">{{ tpl.prefix }}</span>
        </button>
      </template>

      <div v-else class="px-3 py-2 text-xs text-gray-500">
        No templates configured.
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useTasksStore } from '@/stores/tasks'

defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const tasksStore = useTasksStore()

onMounted(() => {
  tasksStore.loadConfig()
})
</script>

<style scoped>
.sidebar-item {
  @apply w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-sidebar-text hover:bg-sidebar-hover transition-colors text-left;
}
</style>
