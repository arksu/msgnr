import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TaskDescriptionEditor from '@/components/tasks/TaskDescriptionEditor.vue'

function mountHost(initialValue = '') {
  const Host = defineComponent({
    components: { TaskDescriptionEditor },
    setup() {
      const value = ref(initialValue)
      return { value }
    },
    template: '<TaskDescriptionEditor v-model="value" />',
  })

  return mount(Host)
}

function getEditorInstance(wrapper: ReturnType<typeof mountHost>) {
  const component = wrapper.getComponent(TaskDescriptionEditor)
  const exposed = (component.vm as { editor?: unknown }).editor as { value?: unknown } | undefined
  return (exposed?.value ?? exposed) as {
    commands: { setContent: (content: string) => boolean }
    getHTML: () => string
  }
}

describe('TaskDescriptionEditor', () => {
  it('initializes rendered editor from markdown', async () => {
    const wrapper = mountHost('# Title\n\n- one')
    await nextTick()

    const editor = getEditorInstance(wrapper)
    expect(editor.getHTML()).toContain('<h1>Title</h1>')
    expect(editor.getHTML()).toContain('<ul>')
  })

  it('updates markdown model when rendered editor changes', async () => {
    const wrapper = mountHost('')
    await nextTick()

    const editor = getEditorInstance(wrapper)
    editor.commands.setContent('<h2>Sync</h2><p><strong>Bold</strong> and <em>italic</em></p>')
    await nextTick()

    const vm = wrapper.vm as { value: string }
    expect(vm.value).toContain('## Sync')
    expect(vm.value).toContain('**Bold**')
    expect(vm.value).toContain('*italic*')
  })

  it('applies markdown edits back into rendered tab', async () => {
    const wrapper = mountHost('Initial')
    await nextTick()

    await wrapper.get('[data-testid="task-description-tab-markdown"]').trigger('click')
    await wrapper.get('[data-testid="task-description-markdown-input"]').setValue('## Updated\n\nBody text')
    await wrapper.get('[data-testid="task-description-tab-rendered"]').trigger('click')
    await nextTick()

    const editor = getEditorInstance(wrapper)
    expect(editor.getHTML()).toContain('<h2>Updated</h2>')
    expect(editor.getHTML()).toContain('<p>Body text</p>')
  })

  it('renders markdown tables and serializes table edits back to markdown', async () => {
    const wrapper = mountHost('| Feature | Works? |\n| --- | --- |\n| Bold | yes |')
    await nextTick()

    const editor = getEditorInstance(wrapper)
    expect(editor.getHTML()).toContain('<table')
    expect(editor.getHTML()).toContain('<th')

    editor.commands.setContent('<table><tbody><tr><th>Feature</th><th>Works?</th></tr><tr><td>Table cell edit</td><td>yes</td></tr></tbody></table>')
    await nextTick()

    const vm = wrapper.vm as { value: string }
    expect(vm.value).toContain('| Feature | Works? |')
    expect(vm.value).toContain('| Table cell edit | yes |')
  })
})
