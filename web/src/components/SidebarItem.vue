<template>
  <div class="relative mx-1 group">
    <button
      class="flex min-h-9 items-center gap-2 px-3 py-1 w-full text-left text-[15px] transition-colors rounded"
      :class="active
        ? 'bg-sidebar-active text-white'
        : (hasUnread ? 'text-sidebar-text hover:bg-sidebar-hover' : 'text-sidebar-textMuted hover:bg-sidebar-hover')"
      v-bind="$attrs"
    >
      <span class="shrink-0 w-8 flex items-center justify-center">
        <slot name="icon" />
      </span>
      <span class="truncate flex-1" :class="[
        hasUnread ? 'font-semibold text-white' : 'font-normal text-sidebar-text',
      ]">
        <slot />
      </span>
      <span
        v-if="(unread ?? 0) > 0"
        class="shrink-0 min-w-[18px] h-[18px] text-[11px] font-bold rounded-full bg-red-500 text-sidebar-unreadBage flex items-center justify-center px-1"
      >
        {{ unread }}
      </span>
      <span
        v-else-if="hasUnreadThreadReplies"
        class="shrink-0 w-2 h-2 rounded-full bg-cyan-300"
        title="Unread thread replies"
      />
    </button>
    <div class="absolute right-7 top-1/2 -translate-y-1/2 z-30">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  active?: boolean
  unread?: number
  hasUnreadThreadReplies?: boolean
}>()

const hasUnread = computed(() => (props.unread ?? 0) > 0)
</script>
