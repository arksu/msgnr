<template>
  <div class="space-y-2">
    <div class="inline-flex rounded border border-chat-border overflow-hidden text-[11px]">
      <button
        type="button"
        class="px-2 py-0.5"
        :class="tab === 'rendered' ? 'bg-accent text-white' : 'bg-chat-input text-gray-300 hover:text-white'"
        data-testid="task-description-tab-rendered"
        @click="switchTab('rendered')"
      >
        Rendered
      </button>
      <button
        type="button"
        class="px-2 py-0.5 border-l border-chat-border"
        :class="tab === 'markdown' ? 'bg-accent text-white' : 'bg-chat-input text-gray-300 hover:text-white'"
        data-testid="task-description-tab-markdown"
        @click="switchTab('markdown')"
      >
        Markdown
      </button>
    </div>

    <div
      v-if="tab === 'rendered'"
      class="border border-chat-border rounded bg-chat-input p-2 space-y-2"
      data-testid="task-description-rendered"
    >
      <BubbleMenu
        v-if="editor && editable"
        :editor="editor"
        :tippy-options="{ placement: 'top', duration: 120, maxWidth: 'none' }"
        class="task-editor-floating-menu"
        data-testid="task-description-bubble-menu"
      >
        <div class="task-editor-menu-panel">
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('paragraph') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().setParagraph().run()"
          >
            P
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('heading', { level: 1 }) ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
          >
            H1
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('heading', { level: 2 }) ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
          >
            H2
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('heading', { level: 3 }) ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
          >
            H3
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('bold') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleBold().run()"
          >
            Bold
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('italic') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleItalic().run()"
          >
            Italic
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('strike') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleStrike().run()"
          >
            Strike
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('code') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleCode().run()"
          >
            Code
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('link') ? 'toolbar-btn-active' : ''"
            @click="toggleLink"
          >
            Link
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :disabled="!isActive('table')"
            @click="editor?.chain().focus().addRowAfter().run()"
          >
            +row
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :disabled="!isActive('table')"
            @click="editor?.chain().focus().deleteRow().run()"
          >
            -row
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :disabled="!isActive('table')"
            @click="editor?.chain().focus().addColumnAfter().run()"
          >
            +col
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :disabled="!isActive('table')"
            @click="editor?.chain().focus().deleteColumn().run()"
          >
            -col
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :disabled="!isActive('table')"
            @click="editor?.chain().focus().deleteTable().run()"
          >
            Del table
          </button>
        </div>
      </BubbleMenu>

      <FloatingMenu
        v-if="editor && editable"
        :editor="editor"
        :tippy-options="{ placement: 'top-start', duration: 120, maxWidth: 'none' }"
        class="task-editor-floating-menu"
        data-testid="task-description-floating-menu"
      >
        <div class="task-editor-menu-panel">
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('paragraph') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().setParagraph().run()"
          >
            P
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('heading', { level: 1 }) ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
          >
            H1
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('heading', { level: 2 }) ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
          >
            H2
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('heading', { level: 3 }) ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
          >
            H3
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('bulletList') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleBulletList().run()"
          >
            UL
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('orderedList') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleOrderedList().run()"
          >
            OL
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('blockquote') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleBlockquote().run()"
          >
            Quote
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('codeBlock') ? 'toolbar-btn-active' : ''"
            @click="editor?.chain().focus().toggleCodeBlock().run()"
          >
            Code Block
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="isActive('table') ? 'toolbar-btn-active' : ''"
            @click="insertTable"
          >
            Table
          </button>
        </div>
      </FloatingMenu>

      <EditorContent :editor="editor" class="task-description-editor-content markdown-body" data-testid="task-description-editor-content" />
    </div>

    <textarea
      v-else
      v-model="markdownDraft"
      class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent resize-y min-h-[100px]"
      :placeholder="placeholder"
      :disabled="!editable"
      data-testid="task-description-markdown-input"
      @blur="emit('blur')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Doc as YDoc } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { BubbleMenu, FloatingMenu } from '@tiptap/vue-3/menus'
import { renderTaskMarkdownToHtml } from '@/utils/taskMarkdown'
import { tiptapJsonToMarkdown } from '@/utils/tiptapMarkdown'

type DescriptionTab = 'rendered' | 'markdown'

const props = withDefaults(defineProps<{
  modelValue: string
  defaultTab?: DescriptionTab
  placeholder?: string
  editable?: boolean
  collabDoc?: YDoc | null
  collabProvider?: { awareness: Awareness } | null
  collabField?: string
  collabUser?: {
    id: string
    name: string
    color: string
  } | null
}>(), {
  defaultTab: 'rendered',
  placeholder: 'Description',
  editable: true,
  collabDoc: null,
  collabProvider: null,
  collabField: 'task_description',
  collabUser: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'blur': []
}>()

const tab = ref<DescriptionTab>(props.defaultTab)
const markdownDraft = ref(props.modelValue ?? '')
const suppressEditorSync = ref(false)
const syncingFromEditor = ref(false)
const syncingFromModel = ref(0)
const DEBUG_TASK_DESC = true

const collabEnabled = computed(() => !!props.collabDoc)
const editable = computed(() => !!props.editable)

function markdownSignature(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  const preview = input.slice(0, 80).replace(/\n/g, '\\n')
  return `len=${input.length},hash=${hash},preview="${preview}"`
}

function descLog(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_TASK_DESC) return
  console.debug('[task-desc-editor]', event, payload)
}

const extensions = computed(() => {
  const list: AnyExtension[] = [
    StarterKit.configure({
      undoRedo: collabEnabled.value ? false : {},
      link: {
        openOnClick: false,
      },
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
  ]

  if (collabEnabled.value && props.collabDoc) {
    list.push(Collaboration.configure({
      document: props.collabDoc,
      field: props.collabField,
    }))
    if (props.collabProvider) {
      list.push(CollaborationCaret.configure({
        provider: props.collabProvider,
        user: {
          id: props.collabUser?.id ?? '',
          name: props.collabUser?.name ?? 'User',
          color: props.collabUser?.color ?? '#60a5fa',
        },
      }))
    }
  }

  return list
})

const editor = useEditor({
  extensions: extensions.value,
  // In collaboration mode, Yjs document state is the source of truth.
  // Seeding HTML here can duplicate content when remote sync arrives.
  content: collabEnabled.value ? '' : renderTaskMarkdownToHtml(markdownDraft.value),
  editable: editable.value,
  editorProps: {
    attributes: {
      class: 'min-h-[140px] text-sm text-gray-100 outline-none',
    },
  },
  onBlur() {
    emit('blur')
  },
  onUpdate({ editor: nextEditor }) {
    if (suppressEditorSync.value) return
    const nextMarkdown = tiptapJsonToMarkdown(nextEditor.getJSON())
    descLog('onUpdate', {
      collab: collabEnabled.value,
      tab: tab.value,
      next: markdownSignature(nextMarkdown),
      current: markdownSignature(markdownDraft.value),
    })
    if (nextMarkdown === markdownDraft.value) return
    syncingFromEditor.value = true
    markdownDraft.value = nextMarkdown
    emit('update:modelValue', nextMarkdown)
    syncingFromEditor.value = false
  },
})

function isActive(name: string, attrs?: Record<string, unknown>) {
  return editor.value?.isActive(name, attrs) ?? false
}

function setEditorContentFromMarkdown(markdown: string, emitUpdate: boolean, reason: string) {
  if (!editor.value) return
  descLog('setEditorContentFromMarkdown', {
    reason,
    collab: collabEnabled.value,
    tab: tab.value,
    emitUpdate,
    markdown: markdownSignature(markdown),
  })
  const html = renderTaskMarkdownToHtml(markdown)
  if (!emitUpdate) {
    suppressEditorSync.value = true
  }
  editor.value.commands.setContent(html, { emitUpdate })
  if (!emitUpdate) {
    suppressEditorSync.value = false
  }
}

function switchTab(nextTab: DescriptionTab) {
  if (tab.value === nextTab) return
  descLog('switchTab', { from: tab.value, to: nextTab, collab: collabEnabled.value })
  tab.value = nextTab
  if (nextTab === 'rendered' && !collabEnabled.value) {
    setEditorContentFromMarkdown(markdownDraft.value, false, 'switch-tab-rendered')
  }
}

function toggleLink() {
  if (!editor.value || !editable.value) return
  const previous = String(editor.value.getAttributes('link').href ?? '')
  const input = window.prompt('Enter URL', previous || 'https://')
  if (input === null) return
  const href = input.trim()
  if (!href) {
    editor.value.chain().focus().unsetLink().run()
    return
  }
  editor.value.chain().focus().setLink({ href }).run()
}

function insertTable() {
  if (!editor.value || !editable.value) return
  if (editor.value.isActive('table')) return
  editor.value.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}

watch(
  () => props.modelValue,
  (next) => {
    const normalized = next ?? ''
    descLog('watch:modelValue', {
      collab: collabEnabled.value,
      tab: tab.value,
      next: markdownSignature(normalized),
      current: markdownSignature(markdownDraft.value),
    })
    if (normalized === markdownDraft.value) return
    syncingFromModel.value += 1
    markdownDraft.value = normalized
    queueMicrotask(() => {
      syncingFromModel.value = Math.max(0, syncingFromModel.value - 1)
    })
    if (collabEnabled.value) {
      return
    }
    if (tab.value === 'rendered') {
      setEditorContentFromMarkdown(normalized, true, 'watch-modelValue')
    }
  },
)

watch(markdownDraft, (next) => {
  descLog('watch:markdownDraft', {
    collab: collabEnabled.value,
    tab: tab.value,
    syncingFromEditor: syncingFromEditor.value,
    syncingFromModel: syncingFromModel.value,
    next: markdownSignature(next),
    modelValue: markdownSignature(props.modelValue ?? ''),
  })
  if (syncingFromModel.value > 0) return
  if (next !== props.modelValue) {
    emit('update:modelValue', next)
  }
  if (syncingFromEditor.value) return
  if (!collabEnabled.value || tab.value !== 'markdown') return
  setEditorContentFromMarkdown(next, true, 'watch-markdownDraft-markdown-tab')
})

watch(
  () => props.editable,
  (next) => {
    editor.value?.setEditable(!!next)
  },
)

watch(editor, (next) => {
  if (!next) return
  if (collabEnabled.value) {
    descLog('watch:editor', { collab: true, skip: true })
    return
  }
  if (tab.value === 'rendered') {
    setEditorContentFromMarkdown(markdownDraft.value, false, 'watch-editor-immediate')
  }
}, { immediate: true })

defineExpose<{ editor: typeof editor }>({
  editor,
})
</script>

<style scoped>
.toolbar-btn {
  @apply px-2 py-1 rounded border border-chat-border text-xs text-gray-300 hover:text-white hover:border-accent/60 bg-chat-bg transition-colors;
}

.toolbar-btn:disabled {
  @apply opacity-50 cursor-not-allowed hover:text-gray-300 hover:border-chat-border;
}

.toolbar-btn-active {
  @apply border-accent text-white bg-accent/20;
}

.task-editor-menu-panel {
  @apply flex flex-wrap gap-1 rounded border border-chat-border bg-chat-bg/95 p-1 shadow-lg;
}

.task-description-editor-content :deep(.ProseMirror) {
  @apply min-h-[140px] rounded border border-chat-border bg-chat-bg px-3 py-2 text-sm text-gray-100 leading-relaxed;
}

.task-description-editor-content :deep(.collaboration-carets__caret) {
  border-left-width: 2px;
  border-left-style: solid;
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
}

.task-description-editor-content :deep(.collaboration-carets__label) {
  @apply absolute -top-5 left-0 rounded px-1.5 py-0.5 text-[10px] text-white whitespace-nowrap;
}
</style>
