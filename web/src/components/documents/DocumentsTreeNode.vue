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
        @click="openDocumentRow"
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
      <button
        ref="menuButtonRef"
        type="button"
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sidebar-textMuted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-hover hover:text-sidebar-text"
        :data-testid="`documents-node-menu-${node.id}`"
        title="Document actions"
        @click.stop="toggleMenu"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
    </div>

    <div v-if="hasChildren && !isCollapsed">
      <DocumentsTreeNode
        v-for="child in childNodes"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-document-id="selectedDocumentId"
        :collapsed-document-ids="collapsedDocumentIds"
        @open-document="$emit('openDocument', $event)"
        @add-child="$emit('addChild', $event)"
        @toggle-collapse="$emit('toggleCollapse', $event)"
        @documents-deleted="$emit('documentsDeleted', $event)"
      />
    </div>
  </div>

  <Teleport to="body">
    <div v-if="menuOpen" class="fixed inset-0 z-50" @click="closeMenu">
      <div
        class="fixed min-w-[140px] rounded-lg border border-chat-border bg-chat-header p-1 shadow-2xl"
        :style="{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }"
        @click.stop
      >
        <button
          type="button"
          class="flex w-full items-center rounded px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200"
          @click="openDeleteConfirm"
        >
          Delete
        </button>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="deleteConfirmOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeDeleteConfirm"
    >
      <div class="w-full max-w-sm rounded-xl border border-chat-border bg-chat-header p-5 shadow-2xl">
        <h3 class="text-base font-semibold text-white">Delete document?</h3>
        <p class="mt-2 text-sm text-gray-300">
          This will delete "{{ node.title }}" and all nested child documents.
        </p>
        <p v-if="deleteError" class="mt-3 text-xs text-red-400">{{ deleteError }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded border border-chat-border px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-white"
            :disabled="deleteLoading"
            @click="closeDeleteConfirm"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            :disabled="deleteLoading"
            @click="confirmDelete"
          >
            {{ deleteLoading ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SidebarDocumentNode } from '@/services/http/documentsApi'
import { useDocumentsStore } from '@/stores/documents'

const props = defineProps<{
  node: SidebarDocumentNode
  level: number
  selectedDocumentId: string | null
  collapsedDocumentIds: string[]
}>()

const documentsStore = useDocumentsStore()
const childNodes = computed(() => normalizeNodes(props.node.children))
const hasChildren = computed(() => childNodes.value.length > 0)
const isCollapsed = computed(() => props.collapsedDocumentIds.includes(props.node.id))
const menuOpen = ref(false)
const deleteConfirmOpen = ref(false)
const deleteLoading = ref(false)
const deleteError = ref('')
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const menuPosition = ref({ top: 0, left: 0 })

const emit = defineEmits<{
  openDocument: [id: string]
  addChild: [id: string]
  toggleCollapse: [id: string]
  documentsDeleted: [ids: string[]]
}>()

function openDocumentRow() {
  closeMenu()
  emit('openDocument', props.node.id)
}

function toggleMenu() {
  if (menuOpen.value) {
    closeMenu()
    return
  }
  const rect = menuButtonRef.value?.getBoundingClientRect()
  if (rect) {
    menuPosition.value = {
      top: rect.bottom + 6,
      left: Math.max(8, rect.right - 140),
    }
  }
  menuOpen.value = true
}

function closeMenu() {
  menuOpen.value = false
}

function openDeleteConfirm() {
  closeMenu()
  deleteError.value = ''
  deleteConfirmOpen.value = true
}

function closeDeleteConfirm() {
  if (deleteLoading.value) return
  deleteConfirmOpen.value = false
  deleteError.value = ''
}

function normalizeNodes(nodes: SidebarDocumentNode[] | null | undefined): SidebarDocumentNode[] {
  return Array.isArray(nodes) ? nodes.filter((node): node is SidebarDocumentNode => !!node) : []
}

function collectSubtreeIds(node: SidebarDocumentNode): string[] {
  return [node.id, ...normalizeNodes(node.children).flatMap(child => collectSubtreeIds(child))]
}

async function confirmDelete() {
  deleteLoading.value = true
  deleteError.value = ''
  try {
    await documentsStore.deleteDocument(props.node.id)
    deleteConfirmOpen.value = false
    emit('documentsDeleted', collectSubtreeIds(props.node))
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : 'Failed to delete document'
  } finally {
    deleteLoading.value = false
  }
}
</script>
