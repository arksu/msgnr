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
      v-show="tab === 'rendered'"
      class="rounded bg-chat-input p-2 space-y-2"
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

      <AttachmentMarkdownContent
        v-if="!editable"
        :markdown="markdownDraft"
      />
      <EditorContent
        v-else
        :editor="editor"
        class="task-description-editor-content markdown-body"
        data-testid="task-description-editor-content"
      />
    </div>

    <textarea
      v-show="tab === 'markdown'"
      ref="markdownInputRef"
      v-model="markdownDraft"
      class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent resize-y min-h-[100px]"
      :placeholder="placeholder"
      :disabled="!editable"
      data-testid="task-description-markdown-input"
      @blur="emit('blur')"
      @paste="onMarkdownPaste"
      @dragover="onMarkdownDragOver"
      @drop="onMarkdownDrop"
    />

    <p
      v-if="attachmentNotice"
      data-testid="task-description-attachment-note"
      class="text-xs"
      :class="attachmentNoticeIsError ? 'text-amber-300' : 'text-gray-500'"
    >
      {{ attachmentNotice }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Doc as YDoc } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { Node, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { BubbleMenu, FloatingMenu } from '@tiptap/vue-3/menus'
import AttachmentMarkdownContent from '@/components/AttachmentMarkdownContent.vue'
import { fetchOwnedAttachmentBlob, uploadOwnedAttachment, type OwnedAttachmentUpload } from '@/services/http/attachmentOwnersApi'
import { openBlobInBrowser, openHrefInBrowser } from '@/utils/attachmentBrowser'
import {
  buildAttachmentUrl,
  buildAttachmentMarkdown,
  parseAttachmentUrl,
  type AttachmentOwnerKind,
} from '@/utils/attachmentMarkdown'
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
  allowLocalDraftSeed?: boolean
  forceLocalSyncToken?: number
  ownerKind?: AttachmentOwnerKind | null
  ownerId?: string | null
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
  allowLocalDraftSeed: true,
  forceLocalSyncToken: 0,
  ownerKind: null,
  ownerId: null,
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
let seedInProgress = false
const DEBUG_TASK_DESC = import.meta.env.DEV

const collabEnabled = computed(() => !!props.collabDoc)
const editable = computed(() => !!props.editable)
const markdownInputRef = ref<HTMLTextAreaElement | null>(null)
const attachmentNotice = ref('')
const attachmentNoticeIsError = ref(false)
const attachmentObjectUrls = new Map<string, string>()
const attachmentLoadsInFlight = new Set<string>()

const AttachmentImage = Node.create({
  name: 'image',
  group: 'block',
  draggable: true,
  selectable: true,
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      title: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'img[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes]
  },
})

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

function editorStateSnapshot() {
  if (!editor.value) {
    return { mounted: false }
  }
  const state = editor.value.state
  const selection = state.selection
  return {
    mounted: true,
    from: selection.from,
    to: selection.to,
    empty: selection.empty,
    anchorParent: selection.$anchor.parent.type.name,
    headParent: selection.$head.parent.type.name,
    docChildCount: state.doc.childCount,
    docSize: state.doc.content.size,
    htmlLength: editor.value.getHTML().length,
  }
}

function setAttachmentNotice(message: string, isError = false) {
  attachmentNotice.value = message
  attachmentNoticeIsError.value = isError
}

function clearAttachmentNotice() {
  attachmentNotice.value = ''
  attachmentNoticeIsError.value = false
}

function attachmentsEnabledForUpload(): boolean {
  return editable.value && !!props.ownerKind && !!props.ownerId
}

function attachmentBlobFetcher(ownerKind: AttachmentOwnerKind, ownerId: string, attachmentId: string): Promise<Blob> {
  return fetchOwnedAttachmentBlob(ownerKind, ownerId, attachmentId)
}

async function openAttachmentLinkFromEditor(href: string) {
  const parsed = parseAttachmentUrl(href)
  if (!parsed) return false

  try {
    await openBlobInBrowser(() => attachmentBlobFetcher(parsed.ownerKind, parsed.ownerId, parsed.attachmentId))
    clearAttachmentNotice()
  } catch (error) {
    setAttachmentNotice(error instanceof Error ? error.message : 'Attachment open failed', true)
  }

  return true
}

function openStandardLinkFromEditor(href: string): boolean {
  if (!href.trim()) return false

  try {
    openHrefInBrowser(href)
    clearAttachmentNotice()
  } catch (error) {
    setAttachmentNotice(error instanceof Error ? error.message : 'Link open failed', true)
  }

  return true
}

function revokeAttachmentObjectUrls() {
  for (const url of attachmentObjectUrls.values()) {
    URL.revokeObjectURL(url)
  }
  attachmentObjectUrls.clear()
  attachmentLoadsInFlight.clear()
}

async function resolveEditorAttachmentImages() {
  const root = editor.value?.view.dom as HTMLElement | undefined
  if (!root) return
  const imageEls = Array.from(root.querySelectorAll('img[src^="msgnr-attachment://"], img[data-attachment-url^="msgnr-attachment://"]')) as HTMLImageElement[]
  for (const imageEl of imageEls) {
    const attachmentUrl = imageEl.dataset.attachmentUrl ?? imageEl.getAttribute('src') ?? ''
    const parsed = parseAttachmentUrl(attachmentUrl)
    if (!parsed) continue
    imageEl.dataset.attachmentUrl = attachmentUrl
    if (attachmentObjectUrls.has(attachmentUrl)) {
      imageEl.src = attachmentObjectUrls.get(attachmentUrl) ?? ''
      continue
    }
    if (attachmentLoadsInFlight.has(attachmentUrl)) continue
    attachmentLoadsInFlight.add(attachmentUrl)
    attachmentBlobFetcher(parsed.ownerKind, parsed.ownerId, parsed.attachmentId)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob)
        attachmentObjectUrls.set(attachmentUrl, objectUrl)
        const currentRoot = editor.value?.view.dom as HTMLElement | undefined
        const pendingEls = currentRoot
          ? Array.from(currentRoot.querySelectorAll(`img[data-attachment-url="${attachmentUrl}"]`)) as HTMLImageElement[]
          : []
        for (const pendingEl of pendingEls) {
          pendingEl.src = objectUrl
          pendingEl.classList.add('attachment-editor-inline-image')
        }
      })
      .catch(() => {
        imageEl.alt = `${imageEl.alt || 'Attachment'} (unavailable)`
      })
      .finally(() => {
        attachmentLoadsInFlight.delete(attachmentUrl)
      })
  }
}

function queueResolveEditorAttachmentImages() {
  queueMicrotask(() => {
    void resolveEditorAttachmentImages()
  })
}

function buildInsertedAttachmentMarkdown(ownerKind: AttachmentOwnerKind, ownerId: string, rows: OwnedAttachmentUpload[]): string {
  return rows.map(row => buildAttachmentMarkdown(
    ownerKind,
    ownerId,
    row.id,
    row.file_name,
    row.mime_type,
  )).join('\n\n')
}

function buildEditorAttachmentNodes(ownerKind: AttachmentOwnerKind, ownerId: string, rows: OwnedAttachmentUpload[]) {
  return rows.map((row) => {
    const url = buildAttachmentUrl(ownerKind, ownerId, row.id)
    if (row.mime_type.startsWith('image/')) {
      return {
        type: 'image',
        attrs: {
          src: url,
          alt: row.file_name,
          title: row.file_name,
        },
      }
    }
    return {
      type: 'paragraph',
      content: [{
        type: 'text',
        text: row.file_name,
        marks: [{
          type: 'link',
          attrs: {
            href: url,
          },
        }],
      }],
    }
  })
}

async function uploadAndInsertFiles(files: File[], target: 'editor' | 'markdown') {
  if (!files.length) return
  if (!attachmentsEnabledForUpload()) {
    setAttachmentNotice('Attachments are available after save.')
    return
  }
  const ownerKind = props.ownerKind
  const ownerId = props.ownerId
  if (!ownerKind || !ownerId) {
    setAttachmentNotice('Attachments are available after save.')
    return
  }

  setAttachmentNotice(`Uploading ${files.length === 1 ? 'attachment' : `${files.length} attachments`}...`)
  try {
    const uploaded = await Promise.all(files.map(file => uploadOwnedAttachment(ownerKind, ownerId, file)))

    if (target === 'editor' && editor.value) {
      editor.value.chain().focus().insertContent(buildEditorAttachmentNodes(ownerKind, ownerId, uploaded)).run()
      queueResolveEditorAttachmentImages()
    } else {
      insertMarkdownAtCursor(buildInsertedAttachmentMarkdown(ownerKind, ownerId, uploaded))
    }
    clearAttachmentNotice()
  } catch (error) {
    setAttachmentNotice(error instanceof Error ? error.message : 'Attachment upload failed', true)
  }
}

function insertMarkdownAtCursor(value: string) {
  const input = markdownInputRef.value
  if (!input) {
    markdownDraft.value = [markdownDraft.value, value].filter(Boolean).join('\n\n')
    emit('update:modelValue', markdownDraft.value)
    return
  }
  const start = input.selectionStart ?? markdownDraft.value.length
  const end = input.selectionEnd ?? start
  const before = markdownDraft.value.slice(0, start)
  const after = markdownDraft.value.slice(end)
  const needsLeadingBreak = before.length > 0 && !before.endsWith('\n')
  const needsTrailingBreak = after.length > 0 && !after.startsWith('\n')
  const inserted = `${needsLeadingBreak ? '\n\n' : ''}${value}${needsTrailingBreak ? '\n\n' : ''}`
  markdownDraft.value = `${before}${inserted}${after}`
  emit('update:modelValue', markdownDraft.value)
  nextTick(() => {
    const caret = before.length + inserted.length
    input.focus()
    input.setSelectionRange(caret, caret)
  })
}

async function onMarkdownPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  await uploadAndInsertFiles(files, 'markdown')
}

function onMarkdownDragOver(event: DragEvent) {
  if ((event.dataTransfer?.files?.length ?? 0) > 0) {
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'copy'
  }
}

async function onMarkdownDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  await uploadAndInsertFiles(files, 'markdown')
}

const extensions = computed(() => {
  const list: AnyExtension[] = [
    StarterKit.configure({
      undoRedo: collabEnabled.value ? false : {},
      link: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      defaultProtocol: 'https',
    }),
    AttachmentImage,
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
    handleDOMEvents: {
      click(_view, event) {
        const target = event.target
        if (!(target instanceof HTMLElement)) return false

        const link = target.closest('a[href]')
        if (!(link instanceof HTMLAnchorElement)) return false

        const href = link.getAttribute('href') ?? ''
        event.preventDefault()
        if (parseAttachmentUrl(href)) {
          void openAttachmentLinkFromEditor(href)
          return true
        }

        return openStandardLinkFromEditor(href)
      },
    },
    handlePaste(_view, event) {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (!files.length) return false
      event.preventDefault()
      void uploadAndInsertFiles(files, 'editor')
      return true
    },
    handleDrop(view, event) {
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length) return false
      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (coords) {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(coords.pos))))
      }
      event.preventDefault()
      void uploadAndInsertFiles(files, 'editor')
      return true
    },
  },
  onBlur() {
    emit('blur')
  },
  onCreate() {
    queueResolveEditorAttachmentImages()
  },
  onUpdate({ editor: nextEditor }) {
    if (suppressEditorSync.value) return
    const nextMarkdown = tiptapJsonToMarkdown(nextEditor.getJSON())
    descLog('onUpdate', {
      collab: collabEnabled.value,
      tab: tab.value,
      next: markdownSignature(nextMarkdown),
      current: markdownSignature(markdownDraft.value),
      snapshot: editorStateSnapshot(),
    })
    if (collabEnabled.value && nextMarkdown.trim() === '' && markdownDraft.value.trim() !== '') {
      descLog('onUpdate:unexpected-empty:suppressed', {
        tab: tab.value,
        previousDraft: markdownSignature(markdownDraft.value),
        snapshot: editorStateSnapshot(),
      })
      return
    }
    if (nextMarkdown === markdownDraft.value) return
    syncingFromEditor.value = true
    markdownDraft.value = nextMarkdown
    emit('update:modelValue', nextMarkdown)
    syncingFromEditor.value = false
    queueResolveEditorAttachmentImages()
  },
})

function isActive(name: string, attrs?: Record<string, unknown>) {
  return editor.value?.isActive(name, attrs) ?? false
}

function setContentWithSafeSelection(html: string): boolean {
  if (!editor.value || !props.collabDoc) return false
  const schema = editor.value.schema
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  const parsedDoc = ProseMirrorDOMParser.fromSchema(schema).parse(wrapper)
  const fragment = props.collabDoc.getXmlFragment(props.collabField)
  props.collabDoc.transact(() => {
    fragment.delete(0, fragment.length)
    prosemirrorJSONToYXmlFragment(schema, parsedDoc.toJSON(), fragment)
  })
  return true
}

function setEditorContentFromMarkdown(markdown: string, emitUpdate: boolean, reason: string) {
  if (!editor.value) return
  const beforeSnapshot = editorStateSnapshot()
  descLog('setEditorContentFromMarkdown', {
    reason,
    collab: collabEnabled.value,
    tab: tab.value,
    emitUpdate,
    markdown: markdownSignature(markdown),
    beforeSnapshot,
  })
  const html = renderTaskMarkdownToHtml(markdown)
  try {
    if (!emitUpdate) {
      suppressEditorSync.value = true
    }
    const strategy = collabEnabled.value ? 'safe-transaction' : 'setContent'
    const ok = collabEnabled.value
      ? setContentWithSafeSelection(html)
      : editor.value.commands.setContent(html, { emitUpdate })
    descLog('setEditorContentFromMarkdown:done', {
      reason,
      collab: collabEnabled.value,
      tab: tab.value,
      emitUpdate,
      strategy,
      ok,
      htmlLength: html.length,
      afterSnapshot: editorStateSnapshot(),
      afterMarkdown: markdownSignature(tiptapJsonToMarkdown(editor.value.getJSON())),
    })
    queueResolveEditorAttachmentImages()
  } catch (error) {
    descLog('setEditorContentFromMarkdown:error', {
      reason,
      collab: collabEnabled.value,
      tab: tab.value,
      emitUpdate,
      htmlLength: html.length,
      error: error instanceof Error ? error.message : String(error),
      afterSnapshot: editorStateSnapshot(),
    })
    throw error
  } finally {
    if (!emitUpdate) {
      suppressEditorSync.value = false
    }
  }
}

function isEditorEffectivelyEmpty(): boolean {
  if (!editor.value) return true
  const currentMarkdown = tiptapJsonToMarkdown(editor.value.getJSON()).trim()
  return currentMarkdown.length === 0
}

function maybeSeedCollabEditorFromDraft(reason: string) {
  if (!collabEnabled.value || !editor.value) return
  if (seedInProgress) {
    descLog('maybeSeedCollabEditorFromDraft:skip-in-progress', { reason })
    return
  }
  const draft = markdownDraft.value
  const empty = isEditorEffectivelyEmpty()
  descLog('maybeSeedCollabEditorFromDraft', {
    reason,
    tab: tab.value,
    allowLocalDraftSeed: props.allowLocalDraftSeed,
    draft: markdownSignature(draft),
    empty,
    snapshot: editorStateSnapshot(),
  })
  if (!props.allowLocalDraftSeed) return
  if (tab.value !== 'rendered') return
  if (draft.trim() === '') return
  if (!empty) return
  seedInProgress = true
  try {
    setEditorContentFromMarkdown(draft, false, reason)
  } finally {
    seedInProgress = false
  }
}

function switchTab(nextTab: DescriptionTab) {
  if (tab.value === nextTab) return
  descLog('switchTab', {
    from: tab.value,
    to: nextTab,
    collab: collabEnabled.value,
    snapshot: editorStateSnapshot(),
  })
  tab.value = nextTab
  if (nextTab === 'rendered') {
    if (!collabEnabled.value) {
      setEditorContentFromMarkdown(markdownDraft.value, false, 'switch-tab-rendered')
      return
    }
    maybeSeedCollabEditorFromDraft('switch-tab-rendered-collab-empty-seed')
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
      nextTick(() => {
        maybeSeedCollabEditorFromDraft('watch-modelValue-collab-seed')
      })
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
  if (syncingFromModel.value > 0) {
    nextTick(() => {
      maybeSeedCollabEditorFromDraft('watch-markdownDraft-syncingFromModel-collab-seed')
    })
    return
  }
  if (next !== props.modelValue) {
    emit('update:modelValue', next)
  }
  if (syncingFromEditor.value) return
  if (!collabEnabled.value) return
  if (tab.value === 'markdown') {
    setEditorContentFromMarkdown(next, false, 'watch-markdownDraft-markdown-tab')
    return
  }
  maybeSeedCollabEditorFromDraft('watch-markdownDraft-rendered-collab-seed')
})

watch(
  () => props.editable,
  (next) => {
    editor.value?.setEditable(!!next)
  },
)

watch(
  [() => props.ownerId, () => props.ownerKind, editable],
  ([ownerId, ownerKind, isEditable]) => {
    if (!isEditable) return
    if (!ownerId || !ownerKind) {
      setAttachmentNotice('Attachments are available after save.')
      return
    }
    if (!attachmentNoticeIsError.value) {
      clearAttachmentNotice()
    }
  },
  { immediate: true },
)

watch(
  () => props.allowLocalDraftSeed,
  (next, prev) => {
    if (!collabEnabled.value || !next || prev === next) return
    nextTick(() => {
      maybeSeedCollabEditorFromDraft('watch-allowLocalDraftSeed-enabled-collab-seed')
    })
  },
)

watch(
  () => props.forceLocalSyncToken,
  (next, prev) => {
    if (!collabEnabled.value || next === prev) return
    setEditorContentFromMarkdown(markdownDraft.value, false, 'watch-forceLocalSyncToken')
  },
)

watch(editor, (next) => {
  if (!next) return
  next.on('transaction', ({ transaction }) => {
    descLog('transaction', {
      collab: collabEnabled.value,
      tab: tab.value,
      docChanged: transaction.docChanged,
      selectionSet: transaction.selectionSet,
      snapshot: editorStateSnapshot(),
    })
    if (transaction.docChanged) {
      queueResolveEditorAttachmentImages()
    }
  })
  if (collabEnabled.value) {
    descLog('watch:editor', { collab: true, skip: true, tab: tab.value })
    maybeSeedCollabEditorFromDraft('watch-editor-collab-initial-seed')
    return
  }
  if (tab.value === 'rendered') {
    setEditorContentFromMarkdown(markdownDraft.value, false, 'watch-editor-immediate')
  }
}, { immediate: true })

onBeforeUnmount(() => {
  revokeAttachmentObjectUrls()
})

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
  @apply min-h-[140px] bg-chat-bg px-3 py-2 text-sm text-gray-100 leading-relaxed;
}

.task-description-editor-content :deep(.attachment-editor-inline-image) {
  @apply max-h-[260px] max-w-full rounded-lg border border-chat-border/70 bg-chat-input/60 shadow-sm;
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
