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
      <div class="flex flex-wrap gap-1">
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
          :class="isActive('code') ? 'toolbar-btn-active' : ''"
          @click="editor?.chain().focus().toggleCode().run()"
        >
          Code
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
          :class="isActive('link') ? 'toolbar-btn-active' : ''"
          @click="toggleLink"
        >
          Link
        </button>
      </div>

      <EditorContent :editor="editor" class="task-description-editor-content markdown-body" data-testid="task-description-editor-content" />
    </div>

    <textarea
      v-else
      v-model="markdownDraft"
      class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent resize-y min-h-[100px]"
      :placeholder="placeholder"
      data-testid="task-description-markdown-input"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { renderMarkdownToHtml } from '@/utils/markdown'
import { tiptapJsonToMarkdown } from '@/utils/tiptapMarkdown'

type DescriptionTab = 'rendered' | 'markdown'

const props = withDefaults(defineProps<{
  modelValue: string
  defaultTab?: DescriptionTab
  placeholder?: string
}>(), {
  defaultTab: 'rendered',
  placeholder: 'Description',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const tab = ref<DescriptionTab>(props.defaultTab)
const markdownDraft = ref(props.modelValue ?? '')
const suppressEditorSync = ref(false)

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      link: {
        openOnClick: false,
      },
    }),
  ],
  content: renderMarkdownToHtml(markdownDraft.value),
  editorProps: {
    attributes: {
      class: 'min-h-[140px] text-sm text-gray-100 outline-none',
    },
  },
  onUpdate({ editor: nextEditor }) {
    if (suppressEditorSync.value) return
    const nextMarkdown = tiptapJsonToMarkdown(nextEditor.getJSON())
    if (nextMarkdown === markdownDraft.value) return
    markdownDraft.value = nextMarkdown
    emit('update:modelValue', nextMarkdown)
  },
})

function isActive(name: string, attrs?: Record<string, unknown>) {
  return editor.value?.isActive(name, attrs) ?? false
}

function setEditorContentFromMarkdown(markdown: string) {
  if (!editor.value) return
  suppressEditorSync.value = true
  editor.value.commands.setContent(renderMarkdownToHtml(markdown), { emitUpdate: false })
  suppressEditorSync.value = false
}

function switchTab(nextTab: DescriptionTab) {
  if (tab.value === nextTab) return
  tab.value = nextTab
  if (nextTab === 'rendered') {
    setEditorContentFromMarkdown(markdownDraft.value)
  }
}

function toggleLink() {
  if (!editor.value) return
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

watch(
  () => props.modelValue,
  (next) => {
    const normalized = next ?? ''
    if (normalized === markdownDraft.value) return
    markdownDraft.value = normalized
    if (tab.value === 'rendered') {
      setEditorContentFromMarkdown(normalized)
    }
  },
)

watch(markdownDraft, (next) => {
  if (next === props.modelValue) return
  emit('update:modelValue', next)
})

watch(editor, (next) => {
  if (!next || tab.value !== 'rendered') return
  setEditorContentFromMarkdown(markdownDraft.value)
}, { immediate: true })

defineExpose<{ editor: typeof editor }>({
  editor,
})
</script>

<style scoped>
.toolbar-btn {
  @apply px-2 py-1 rounded border border-chat-border text-xs text-gray-300 hover:text-white hover:border-accent/60 bg-chat-bg transition-colors;
}

.toolbar-btn-active {
  @apply border-accent text-white bg-accent/20;
}

.task-description-editor-content :deep(.ProseMirror) {
  @apply min-h-[140px] rounded border border-chat-border bg-chat-bg px-3 py-2 text-sm text-gray-100 leading-relaxed;
}

</style>
