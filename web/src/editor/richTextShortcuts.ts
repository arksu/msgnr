import { Extension, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

const CODE_FENCE_RE = /^```([\w-]+)?$/

function convertParagraphToCodeBlock(editor: Editor, language: string | null = null): boolean {
  const { selection, schema } = editor.state
  if (!selection.empty) return false

  const parent = selection.$from.parent
  if (parent.type.name !== 'paragraph') return false

  const codeBlock = schema.nodes.codeBlock
  if (!codeBlock) return false

  return editor.commands.command(({ tr, dispatch }) => {
    const start = tr.selection.$from.start()
    const end = tr.selection.$from.end()
    tr.delete(start, end)

    const blockStart = tr.selection.$from.before()
    const blockEnd = tr.selection.$from.after()
    tr.setBlockType(blockStart, blockEnd, codeBlock, {
      language,
    })

    dispatch?.(tr)
    return true
  })
}

export function shouldConvertFenceParagraph(editor: Editor): boolean {
  const { selection } = editor.state
  if (!selection.empty) return false
  const parent = selection.$from.parent
  if (parent.type.name !== 'paragraph') return false
  return CODE_FENCE_RE.test(parent.textContent.trim())
}

export function convertFenceParagraphToCodeBlock(editor: Editor): boolean {
  const { selection } = editor.state
  if (!selection.empty) return false

  const parent = selection.$from.parent
  if (parent.type.name !== 'paragraph') return false

  const match = parent.textContent.trim().match(CODE_FENCE_RE)
  if (!match) return false

  return convertParagraphToCodeBlock(editor, match[1] ?? null)
}

export function shouldConvertFenceOnBacktick(editor: Editor, text: string): boolean {
  if (text !== '`') return false
  if (editor.isActive('code') || editor.isActive('codeBlock')) return false

  const { selection } = editor.state
  if (!selection.empty) return false

  const parent = selection.$from.parent
  if (parent.type.name !== 'paragraph') return false

  const before = parent.textBetween(0, selection.$from.parentOffset, '\n', '\uFFFC')
  const after = parent.textBetween(selection.$from.parentOffset, parent.content.size, '\n', '\uFFFC')
  return `${before}${text}${after}` === '```'
}

export function convertFenceOnBacktick(editor: Editor): boolean {
  return convertParagraphToCodeBlock(editor, null)
}

export function shouldSubmitOnEnter(editor: Editor): boolean {
  const { selection } = editor.state
  if (!selection.empty || selection.$from.parent.type.name !== 'paragraph') {
    return false
  }

  return !(
    editor.isActive('bulletList')
    || editor.isActive('orderedList')
    || editor.isActive('taskList')
    || editor.isActive('blockquote')
    || editor.isActive('codeBlock')
  )
}

export const FenceOnEnterExtension = Extension.create({
  name: 'fenceOnEnter',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput: (_view, _from, _to, text) => {
            if (!shouldConvertFenceOnBacktick(this.editor, text)) return false
            return convertFenceOnBacktick(this.editor)
          },
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (!shouldConvertFenceParagraph(this.editor)) return false
        return convertFenceParagraphToCodeBlock(this.editor)
      },
      Space: () => {
        if (!shouldConvertFenceParagraph(this.editor)) return false
        return convertFenceParagraphToCodeBlock(this.editor)
      },
    }
  },
})
