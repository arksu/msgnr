import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import VirtualMessageTimeline from '@/components/chat/VirtualMessageTimeline.vue'

interface TimelineItem {
  id: string
  body: string
}

function buildItems(start: number, count: number): TimelineItem[] {
  return Array.from({ length: count }, (_, offset) => ({
    id: `message-${start + offset}`,
    body: `Message ${start + offset}`,
  }))
}

function mountTimeline(items: TimelineItem[], pinnedIds: string[] = []) {
  const Host = defineComponent({
    components: { VirtualMessageTimeline },
    setup() {
      const scrollEl = ref<HTMLElement | null>(null)
      const timeline = ref<{
        restoreAnchor: (messageId: string, offsetFromViewportTop: number) => boolean
      } | null>(null)
      const timelineItems = ref(items)
      const pinned = ref(pinnedIds)
      return { scrollEl, timeline, timelineItems, pinned }
    },
    template: `
      <div ref="scrollEl" data-testid="scroll">
        <VirtualMessageTimeline
          ref="timeline"
          :items="timelineItems"
          :scroll-container="scrollEl"
          :keep-rendered-ids="pinned"
        >
          <template #default="{ item }">
            <div :data-testid="'row-' + item.id">{{ item.body }}</div>
          </template>
        </VirtualMessageTimeline>
      </div>
    `,
  })

  return mount(Host)
}

describe('VirtualMessageTimeline', () => {
  it('bounds mounted rows while retaining a focused or edited offscreen row', async () => {
    const wrapper = mountTimeline(buildItems(0, 200), ['message-199'])
    const scroll = wrapper.get('[data-testid="scroll"]').element as HTMLDivElement
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 400 })
    scroll.dispatchEvent(new Event('scroll'))
    await nextTick()

    const rows = wrapper.findAll('[data-testid^="row-"]')
    expect(rows.length).toBeLessThan(200)
    expect(wrapper.find('[data-testid="row-message-199"]').exists()).toBe(true)
  })

  it('restores an existing visible message at the same viewport offset after a prepend', async () => {
    const wrapper = mountTimeline(buildItems(20, 100))
    const scroll = wrapper.get('[data-testid="scroll"]').element as HTMLDivElement
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 400 })
    await nextTick()

    const timeline = (wrapper.vm as unknown as {
      timeline: { restoreAnchor: (messageId: string, offsetFromViewportTop: number) => boolean } | null
    }).timeline
    if (!timeline) throw new Error('timeline was not mounted')
    expect(timeline.restoreAnchor('message-80', 17)).toBe(true)
    expect(scroll.scrollTop).toBe(60 * 96 - 17)

    const host = wrapper.vm as unknown as { timelineItems: TimelineItem[] }
    host.timelineItems = [...buildItems(10, 10), ...host.timelineItems]
    await nextTick()

    expect(timeline.restoreAnchor('message-80', 17)).toBe(true)
    expect(scroll.scrollTop).toBe(70 * 96 - 17)
  })
})
