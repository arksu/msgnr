<template>
  <div>
    <div
      class="group flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors"
      :class="selectedDocumentId === node.id ? 'bg-sidebar-active text-white' : 'text-sidebar-text hover:bg-sidebar-hover'"
      :style="{ paddingLeft: `${8 + (level * 14)}px` }"
    >
      <button
        v-if="hasChildren"
        type="button"
        class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-sidebar-textMuted transition-colors hover:bg-sidebar-hover hover:text-sidebar-text"
        :data-testid="`documents-node-toggle-${node.id}`"
        @click.stop="$emit('toggleCollapse', node.id)"
      >
        <svg
          class="h-3 w-3 shrink-0 transition-transform"
          :class="isCollapsed ? '' : 'rotate-90'"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fill-rule="evenodd"
            d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
      <span v-else class="h-4 w-4 shrink-0" aria-hidden="true" />
      <button
        type="button"
        class="min-w-0 flex-1 truncate text-left"
        :data-testid="`documents-node-${node.id}`"
        @click="$emit('openDocument', node.id)"
      >
        {{ node.title }}
      </button>
      <button
        type="button"
        class="h-5 w-5 shrink-0 rounded text-sidebar-textMuted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-hover hover:text-sidebar-text"
        :data-testid="`documents-node-add-${node.id}`"
        title="Add child document"
        @click.stop="$emit('addChild', node.id)"
      >
        +
      </button>
    </div>

    <div v-if="hasChildren && !isCollapsed">
      <DocumentsTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-document-id="selectedDocumentId"
        :collapsed-document-ids="collapsedDocumentIds"
        @open-document="$emit('openDocument', $event)"
        @add-child="$emit('addChild', $event)"
        @toggle-collapse="$emit('toggleCollapse', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SidebarDocumentNode } from '@/services/http/documentsApi'

const props = defineProps<{
  node: SidebarDocumentNode
  level: number
  selectedDocumentId: string | null
  collapsedDocumentIds: string[]
}>()

const hasChildren = computed(() => props.node.children.length > 0)
const isCollapsed = computed(() => props.collapsedDocumentIds.includes(props.node.id))

defineEmits<{
  openDocument: [id: string]
  addChild: [id: string]
  toggleCollapse: [id: string]
}>()
</script>
