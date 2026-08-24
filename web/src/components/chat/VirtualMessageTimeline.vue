<template>
  <div ref="contentEl" class="min-h-full">
    <div ref="beforeEl">
      <slot name="before" />
    </div>

    <div class="relative" :style="{ height: `${layout.totalHeight}px` }">
      <div
        v-for="entry in renderedEntries"
        :key="entry.id"
        :ref="(element) => setRowElement(entry.id, element)"
        class="absolute inset-x-0 top-0"
        :style="{ transform: `translateY(${entry.start}px)` }"
      >
        <slot :item="entry.item" :index="entry.index" />
      </div>
    </div>

    <div ref="afterEl">
      <slot name="after" />
    </div>
  </div>
</template>

<script setup lang="ts" generic="T extends { id: string | number }">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'

interface VirtualTimelineEntry<T> {
  id: string
  index: number
  item: T
  start: number
  height: number
}

interface TimelineLayout<T> {
  entries: VirtualTimelineEntry<T>[]
  entryById: Map<string, VirtualTimelineEntry<T>>
  totalHeight: number
}

const props = withDefaults(
  defineProps<{
    items: T[]
    scrollContainer: HTMLElement | null
    estimatedRowHeight?: number
    overscan?: number
    rowGap?: number
    keepRenderedIds?: Array<string | number>
  }>(),
  {
    estimatedRowHeight: 96,
    overscan: 720,
    rowGap: 0,
    keepRenderedIds: () => [],
  },
)

const emit = defineEmits<{
  contentResize: []
}>()

const VIRTUALIZE_AFTER = 80
const FALLBACK_VIEWPORT_HEIGHT = 800

const contentEl = ref<HTMLElement | null>(null)
const beforeEl = ref<HTMLElement | null>(null)
const afterEl = ref<HTMLElement | null>(null)
const viewportTop = ref(0)
const viewportHeight = ref(0)
const beforeHeight = ref(0)
const measurementVersion = ref(0)
const rowHeights = new Map<string, number>()
const rowElements = new Map<string, HTMLElement>()

let rowResizeObserver: ResizeObserver | null = null
let staticResizeObserver: ResizeObserver | null = null
let observedScrollContainer: HTMLElement | null = null

function itemId(item: T): string {
  return String(item.id)
}

const layout = computed<TimelineLayout<T>>(() => {
  // Make row measurements a dependency without copying a potentially large map.
  measurementVersion.value

  let offset = 0
  const entries: VirtualTimelineEntry<T>[] = []
  const entryById = new Map<string, VirtualTimelineEntry<T>>()

  for (let index = 0; index < props.items.length; index += 1) {
    if (index > 0) offset += props.rowGap
    const item = props.items[index]
    const id = itemId(item)
    const height = rowHeights.get(id) ?? props.estimatedRowHeight
    const entry = { id, index, item, start: offset, height }
    entries.push(entry)
    entryById.set(id, entry)
    offset += height
  }

  return { entries, entryById, totalHeight: offset }
})

function updateViewport() {
  const container = props.scrollContainer
  if (!container) return

  viewportTop.value = container.scrollTop
  viewportHeight.value = container.clientHeight || FALLBACK_VIEWPORT_HEIGHT
}

function syncStaticHeight() {
  const nextHeight = beforeEl.value?.offsetHeight ?? 0
  if (nextHeight === beforeHeight.value) return

  beforeHeight.value = nextHeight
  updateViewport()
  emit('contentResize')
}

function findEntryAtOffset(offset: number): VirtualTimelineEntry<T> | undefined {
  const entries = layout.value.entries
  let low = 0
  let high = entries.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const entry = entries[middle]
    if (offset < entry.start) {
      high = middle - 1
    } else if (offset >= entry.start + entry.height) {
      low = middle + 1
    } else {
      return entry
    }
  }

  return entries[Math.max(0, Math.min(low, entries.length - 1))]
}

const renderedEntries = computed(() => {
  const entries = layout.value.entries
  if (entries.length <= VIRTUALIZE_AFTER) return entries

  const top = Math.max(0, viewportTop.value - beforeHeight.value - props.overscan)
  const bottom = Math.max(
    top,
    viewportTop.value - beforeHeight.value + (viewportHeight.value || FALLBACK_VIEWPORT_HEIGHT) + props.overscan,
  )
  const first = findEntryAtOffset(top)?.index ?? 0
  const last = findEntryAtOffset(bottom)?.index ?? entries.length - 1
  const selectedIndexes = new Set<number>()

  for (let index = Math.max(0, first); index <= Math.min(entries.length - 1, last); index += 1) {
    selectedIndexes.add(index)
  }

  for (const id of props.keepRenderedIds) {
    const entry = layout.value.entryById.get(String(id))
    if (entry) selectedIndexes.add(entry.index)
  }

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .map((index) => entries[index])
})

function setRowElement(id: string, element: Element | ComponentPublicInstance | null) {
  const previous = rowElements.get(id)
  if (previous) {
    rowResizeObserver?.unobserve(previous)
    rowElements.delete(id)
  }

  if (!(element instanceof HTMLElement)) return
  rowElements.set(id, element)
  rowResizeObserver?.observe(element)
}

function handleRowResize(entries: ResizeObserverEntry[]) {
  let changed = false
  let scrollAdjustment = 0
  const currentLayout = layout.value
  const visibleTop = viewportTop.value - beforeHeight.value

  for (const entry of entries) {
    const row = entry.target as HTMLElement
    let rowId: string | undefined
    // A ResizeObserver entry has no user data. The map is bounded by rendered rows,
    // so resolving its id here is cheap and avoids DOM attributes leaking into slots.
    for (const [candidateId, candidateRow] of rowElements) {
      if (candidateRow === row) {
        rowId = candidateId
        break
      }
    }
    if (!rowId) continue

    const nextHeight = Math.max(1, Math.ceil(entry.contentRect.height))
    const previousHeight = rowHeights.get(rowId) ?? props.estimatedRowHeight
    if (nextHeight === previousHeight) continue

    const layoutEntry = currentLayout.entryById.get(rowId)
    if (layoutEntry && layoutEntry.start < visibleTop) {
      scrollAdjustment += nextHeight - previousHeight
    }
    rowHeights.set(rowId, nextHeight)
    changed = true
  }

  if (!changed) return

  if (scrollAdjustment !== 0 && props.scrollContainer) {
    props.scrollContainer.scrollTop += scrollAdjustment
  }
  measurementVersion.value += 1
  updateViewport()
  emit('contentResize')
}

function attachScrollContainer(container: HTMLElement | null) {
  if (observedScrollContainer === container) return

  if (observedScrollContainer) {
    observedScrollContainer.removeEventListener('scroll', updateViewport)
    staticResizeObserver?.unobserve(observedScrollContainer)
  }

  observedScrollContainer = container
  if (!container) return

  container.addEventListener('scroll', updateViewport, { passive: true })
  staticResizeObserver?.observe(container)
  updateViewport()
}

function restoreAnchor(messageId: string | number, offsetFromViewportTop: number): boolean {
  const entry = layout.value.entryById.get(String(messageId))
  const container = props.scrollContainer
  if (!entry || !container) return false

  container.scrollTop = Math.max(0, beforeHeight.value + entry.start - offsetFromViewportTop)
  updateViewport()
  return true
}

async function scrollToMessage(messageId: string | number, options: ScrollIntoViewOptions = { block: 'center' }): Promise<boolean> {
  const entry = layout.value.entryById.get(String(messageId))
  const container = props.scrollContainer
  if (!entry || !container) return false

  const targetTop = beforeHeight.value + entry.start
  if (options.block === 'start') {
    container.scrollTop = targetTop
  } else if (options.block === 'end') {
    container.scrollTop = Math.max(0, targetTop + entry.height - container.clientHeight)
  } else {
    container.scrollTop = Math.max(0, targetTop - Math.max(0, (container.clientHeight - entry.height) / 2))
  }
  updateViewport()
  await nextTick()
  rowElements.get(entry.id)?.scrollIntoView(options)
  return true
}

function removeMissingMeasurements() {
  const currentIds = new Set(props.items.map(itemId))
  let removed = false
  for (const id of rowHeights.keys()) {
    if (!currentIds.has(id)) {
      rowHeights.delete(id)
      removed = true
    }
  }
  if (removed) measurementVersion.value += 1
}

watch(
  () => props.scrollContainer,
  (container) => attachScrollContainer(container),
  { immediate: true },
)

watch(
  () => props.items.map(itemId).join('\u0000'),
  async () => {
    removeMissingMeasurements()
    await nextTick()
    syncStaticHeight()
    updateViewport()
  },
)

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    rowResizeObserver = new ResizeObserver(handleRowResize)
    staticResizeObserver = new ResizeObserver(() => {
      syncStaticHeight()
      updateViewport()
    })
    if (beforeEl.value) staticResizeObserver.observe(beforeEl.value)
    if (afterEl.value) staticResizeObserver.observe(afterEl.value)
    if (props.scrollContainer) staticResizeObserver.observe(props.scrollContainer)
    for (const row of rowElements.values()) rowResizeObserver.observe(row)
  }
  attachScrollContainer(props.scrollContainer)
  void nextTick().then(syncStaticHeight)
})

onBeforeUnmount(() => {
  if (observedScrollContainer) {
    observedScrollContainer.removeEventListener('scroll', updateViewport)
  }
  rowResizeObserver?.disconnect()
  staticResizeObserver?.disconnect()
  rowElements.clear()
})

defineExpose({
  restoreAnchor,
  scrollToMessage,
  contentElement: contentEl,
})
</script>
