import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import RichTextComposer from '@/components/RichTextComposer.vue'

async function waitForEditor(wrapper: ReturnType<typeof mount>) {
  for (let index = 0; index < 10; index += 1) {
    await flushPromises()
    await nextTick()
    const vm = wrapper.vm as unknown as { getEditor?: () => unknown }
    if (wrapper.find('.ProseMirror').exists() && vm.getEditor?.()) return
  }
  throw new Error('editor did not mount')
}

function editorInstance(wrapper: ReturnType<typeof mount>) {
  const vm = wrapper.vm as unknown as { getEditor: () => any }
  return vm.getEditor()
}

function typeText(wrapper: ReturnType<typeof mount>, text: string) {
  const editor = editorInstance(wrapper)
  const view = editor.view

  for (const char of text) {
    const from = view.state.selection.from
    const to = view.state.selection.to
    let handled = false
    view.someProp('handleTextInput', (handler: (view: any, from: number, to: number, text: string) => boolean) => {
      handled = handler(view, from, to, char)
      return handled
    })
    if (!handled) {
      view.dispatch(view.state.tr.insertText(char, from, to))
    }
  }
}

async function insertHardBreak(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('.ProseMirror').trigger('keydown', { key: 'Enter', shiftKey: true })
  await flushPromises()
}

describe('RichTextComposer shortcuts', () => {
  it('converts 1. space into an ordered list', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, '1. ')
    await flushPromises()

    expect(editorInstance(wrapper).isActive('orderedList')).toBe(true)
    expect(wrapper.get('.ProseMirror').classes()).not.toContain('is-empty')
  })

  it('converts dash-space into a bullet list', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, '- ')
    await flushPromises()

    expect(editorInstance(wrapper).isActive('bulletList')).toBe(true)
  })

  it('splits the current paragraph when ordered-list shortcut is typed after a hard break', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, 'alpha')
    await insertHardBreak(wrapper)
    typeText(wrapper, '1. ')
    await flushPromises()

    const content = editorInstance(wrapper).getJSON().content ?? []
    expect(content[0]?.type).toBe('paragraph')
    expect(content[1]?.type).toBe('orderedList')
    expect(editorInstance(wrapper).getJSON().content?.[0]?.content?.[0]?.text).toBe('alpha')
    expect(editorInstance(wrapper).isActive('orderedList')).toBe(true)
  })

  it('splits the current paragraph when bullet-list shortcut is typed after a hard break', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, 'alpha')
    await insertHardBreak(wrapper)
    typeText(wrapper, '- ')
    await flushPromises()

    const content = editorInstance(wrapper).getJSON().content ?? []
    expect(content[0]?.type).toBe('paragraph')
    expect(content[1]?.type).toBe('bulletList')
    expect(editorInstance(wrapper).getJSON().content?.[0]?.content?.[0]?.text).toBe('alpha')
    expect(editorInstance(wrapper).isActive('bulletList')).toBe(true)
  })

  it('converts task markers when task items are enabled', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
        enableTaskItems: true,
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, '[ ] ')
    await flushPromises()

    expect(editorInstance(wrapper).isActive('taskList')).toBe(true)
  })

  it('converts triple backticks plus Enter into a code block', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, '```')
    await wrapper.get('.ProseMirror').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(editorInstance(wrapper).isActive('codeBlock')).toBe(true)
  })

  it('converts triple backticks immediately into a code block', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, '```')
    await flushPromises()

    expect(editorInstance(wrapper).isActive('codeBlock')).toBe(true)
    expect(editorInstance(wrapper).getHTML()).toContain('<pre><code></code></pre>')
  })

  it('splits the current paragraph when triple backticks are typed after a hard break', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, 'alpha')
    await insertHardBreak(wrapper)
    typeText(wrapper, '```')
    await flushPromises()

    const content = editorInstance(wrapper).getJSON().content ?? []
    expect(content[0]?.type).toBe('paragraph')
    expect(content[1]?.type).toBe('codeBlock')
    expect(editorInstance(wrapper).getJSON().content?.[0]?.content?.[0]?.text).toBe('alpha')
    expect(editorInstance(wrapper).isActive('codeBlock')).toBe(true)
  })

  it('prefers code block conversion over submit-on-enter when the line is a fence', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
        submitOnEnter: true,
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, '```')
    await wrapper.get('.ProseMirror').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeFalsy()
    expect(editorInstance(wrapper).isActive('codeBlock')).toBe(true)
  })

  it('does not submit when Enter is pressed on a fence after a hard break', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
        submitOnEnter: true,
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, 'alpha')
    await insertHardBreak(wrapper)
    typeText(wrapper, '```ts')
    await wrapper.get('.ProseMirror').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeFalsy()
    const content = editorInstance(wrapper).getJSON().content ?? []
    expect(content[0]?.type).toBe('paragraph')
    expect(content[1]?.type).toBe('codeBlock')
    expect(editorInstance(wrapper).isActive('codeBlock')).toBe(true)
  })

  it('does not submit when Enter is pressed on a visual-line list shortcut candidate', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
        submitOnEnter: true,
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, 'alpha')
    await insertHardBreak(wrapper)
    typeText(wrapper, '1.')
    await wrapper.get('.ProseMirror').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeFalsy()
  })

  it('converts single backticks into inline code', async () => {
    const wrapper = mount(RichTextComposer, {
      props: {
        modelValue: '',
      },
      attachTo: document.body,
    })
    await waitForEditor(wrapper)

    typeText(wrapper, '`code`')
    await flushPromises()

    expect(editorInstance(wrapper).getHTML()).toContain('<code>code</code>')
  })
})
