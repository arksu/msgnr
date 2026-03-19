<template>
  <div>
    <div
      class="group flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors"
      :class="selectedDocumentId === node.id ? 'bg-sidebar-active text-white' : 'text-sidebar-text hover:bg-sidebar-hover'"
      :style="{ paddingLeft: `${8 + (level * 14)}px` }"
    >
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
        @click="$emit('addChild', node.id)"
      >
        +
      </button>
    </div>

    <div v-if="node.children.length > 0">
      <DocumentsTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-document-id="selectedDocumentId"
        @open-document="$emit('openDocument', $event)"
        @add-child="$emit('addChild', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SidebarDocumentNode } from '@/services/http/documentsApi'

defineProps<{
  node: SidebarDocumentNode
  level: number
  selectedDocumentId: string | null
}>()

defineEmits<{
  openDocument: [id: string]
  addChild: [id: string]
}>()
</script>
