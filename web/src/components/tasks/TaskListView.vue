<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Toolbar -->
    <div class="shrink-0 px-6 py-3 border-b border-chat-border space-y-2">
      <!-- Row 1: search + controls -->
      <div class="flex items-center gap-3">
        <div class="relative flex-1 max-w-sm">
          <svg
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            v-model="searchInput"
            type="text"
            placeholder="Search by ID, title, description…"
            class="w-full bg-chat-input border border-chat-border rounded pl-9 pr-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-accent"
            @input="onSearchInput"
          />
        </div>

        <button
          class="toolbar-btn"
          :class="filtersVisible ? 'border-accent/60 text-accent' : ''"
          @click="filtersVisible = !filtersVisible"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M3 6h18M7 12h10M11 18h2"/>
          </svg>
          Filters
          <span v-if="activeFilterCount > 0" class="ml-1 bg-accent text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
            {{ activeFilterCount }}
          </span>
        </button>

        <button
          class="toolbar-btn"
          :class="isGrouped ? 'border-accent/60 text-accent' : ''"
          @click="toggleGroupBy"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          Group by status
        </button>

        <div class="flex-1" />

        <span class="text-xs text-gray-500">
          {{ tasksStore.taskListTotal }} task{{ tasksStore.taskListTotal === 1 ? '' : 's' }}
        </span>
      </div>

      <!-- Row 2: filters (collapsible) -->
      <div v-if="filtersVisible" class="flex items-center gap-3 flex-wrap">
        <!-- Status filter -->
        <div class="relative" ref="statusDropdownEl">
          <button
            class="filter-chip"
            :class="selectedStatusIds.length ? 'active' : ''"
            @click="statusDropdownOpen = !statusDropdownOpen"
          >
            Status
            <span v-if="selectedStatusIds.length" class="filter-chip-count">{{ selectedStatusIds.length }}</span>
            <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div v-if="statusDropdownOpen" class="dropdown-menu">
            <label v-for="s in tasksStore.activeStatuses" :key="s.id" class="dropdown-item">
              <input type="checkbox" :value="s.id" v-model="selectedStatusIds" class="mr-2 accent-accent" />
              {{ s.name }}
            </label>
            <div v-if="tasksStore.activeStatuses.length === 0" class="px-3 py-2 text-xs text-gray-500">No statuses</div>
          </div>
        </div>

        <!-- Template filter -->
        <div class="relative" ref="templateDropdownEl">
          <button
            class="filter-chip"
            :class="selectedTemplateId ? 'active' : ''"
            @click="templateDropdownOpen = !templateDropdownOpen"
          >
            Template
            <span v-if="selectedTemplateId" class="filter-chip-count font-mono">{{ selectedTemplatePrefix }}</span>
            <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div v-if="templateDropdownOpen" class="dropdown-menu">
            <button class="dropdown-item w-full text-left" @click="selectTemplate(null)">
              <span :class="!selectedTemplateId ? 'text-accent' : ''">All templates</span>
            </button>
            <button
              v-for="t in tasksStore.activeTemplates"
              :key="t.id"
              class="dropdown-item w-full text-left font-mono"
              @click="selectTemplate(t.id)"
            >
              <span :class="selectedTemplateId === t.id ? 'text-accent' : ''">{{ t.prefix }}</span>
            </button>
          </div>
        </div>

        <!-- Assignee filter (only shown when at least one template has an assignee field) -->
        <div v-if="hasAssigneeFields" class="relative" ref="assigneeDropdownEl">
          <button
            class="filter-chip"
            :class="selectedAssigneeIds.length ? 'active' : ''"
            @click="assigneeDropdownOpen = !assigneeDropdownOpen"
          >
            Assignee
            <span v-if="selectedAssigneeIds.length" class="filter-chip-count">{{ selectedAssigneeIds.length }}</span>
            <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div v-if="assigneeDropdownOpen" class="dropdown-menu w-56">
            <!-- Cross-template ambiguity warning -->
            <div
              v-if="selectedAssigneeIds.length && !resolveAssigneeFieldId()"
              class="px-3 py-2 text-xs text-amber-400 border-b border-chat-border"
            >
              Select a template to apply this filter.
            </div>
            <div class="p-2 border-b border-chat-border">
              <input
                v-model="assigneeSearch"
                type="text"
                placeholder="Search users…"
                class="w-full bg-chat-bg border border-chat-border rounded px-2 py-1 text-white text-sm outline-none focus:border-accent"
              />
            </div>
            <div class="max-h-52 overflow-y-auto py-1">
              <div v-if="filteredUserOptions.length === 0" class="px-3 py-2 text-xs text-gray-500">No users found</div>
              <label
                v-for="u in filteredUserOptions"
                :key="u.value"
                class="dropdown-item cursor-pointer"
              >
                <input type="checkbox" :value="u.value" v-model="selectedAssigneeIds" class="mr-2 accent-accent shrink-0" />
                <UserAvatar
                  :user-id="u.value"
                  :display-name="u.label"
                  :avatar-url="u.avatarUrl"
                  size="xs"
                />
                <span class="truncate">{{ u.label }}</span>
              </label>
            </div>
          </div>
        </div>

        <button v-if="activeFilterCount > 0" class="text-xs text-gray-500 hover:text-gray-300 transition-colors" @click="clearFilters">
          Clear all
        </button>
      </div>
    </div>

    <!-- Loading / error states -->
    <div v-if="tasksStore.taskListLoading && tasksStore.taskList.length === 0" class="flex-1 flex items-center justify-center text-gray-500 text-sm">
      Loading…
    </div>
    <div v-else-if="tasksStore.taskListError" class="flex-1 flex items-center justify-center text-red-400 text-sm">
      {{ tasksStore.taskListError }}
    </div>

    <!-- Table area -->
    <div v-else class="flex-1 overflow-y-auto">
      <!-- Empty state -->
      <div
        v-if="tasksStore.taskList.length === 0"
        class="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-2"
      >
        <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 11h6M9 15h4"/>
        </svg>
        <span>No tasks found</span>
        <button class="text-accent hover:underline text-xs mt-1" @click="tasksStore.openCreateDialog">Create a task</button>
      </div>

      <!-- Flat list -->
      <table v-else-if="!isGrouped" class="w-full text-sm">
        <thead class="sticky top-0 bg-chat-bg z-10">
          <tr class="border-b border-chat-border text-left">
            <th class="th w-28" @click="toggleSort('id')">ID <SortIcon field="id" :current="sortBy" :order="sortOrder" /></th>
            <th class="th" @click="toggleSort('title')">Title <SortIcon field="title" :current="sortBy" :order="sortOrder" /></th>
            <th class="th w-36" @click="toggleSort('status')">Status <SortIcon field="status" :current="sortBy" :order="sortOrder" /></th>
            <th class="th w-36" @click="toggleSort('created_at')">Created <SortIcon field="created_at" :current="sortBy" :order="sortOrder" /></th>
            <th class="th w-36" @click="toggleSort('updated_at')">Updated <SortIcon field="updated_at" :current="sortBy" :order="sortOrder" /></th>
          </tr>
        </thead>
        <tbody>
          <TaskRow
            v-for="item in tasksStore.taskList"
            :key="item.id"
            :item="item"
            :status-name="statusName(item.status_id)"
            @click="emit('openTask', item.id)"
          />
        </tbody>
      </table>

      <!-- Grouped list -->
      <template v-else>
        <template v-for="group in tasksStore.taskListGroups" :key="group.status.id">
          <div class="px-6 py-2 border-b border-chat-border bg-chat-input/30 text-xs font-semibold text-gray-400 uppercase tracking-wider sticky top-0 z-10">
            {{ group.status.name }}
            <span class="ml-2 text-gray-600 font-normal normal-case">{{ group.total }}</span>
          </div>
          <table class="w-full text-sm">
            <thead class="sr-only">
              <tr><th>ID</th><th>Title</th><th>Status</th><th>Created</th><th>Updated</th></tr>
            </thead>
            <tbody>
              <TaskRow
                v-for="item in group.tasks"
                :key="item.id"
                :item="item"
                :status-name="group.status.name"
                @click="emit('openTask', item.id)"
              />
            </tbody>
          </table>
        </template>
      </template>
    </div>

    <!-- Pagination -->
    <div
      v-if="totalPages > 1"
      class="shrink-0 flex items-center justify-center gap-1 px-6 py-3 border-t border-chat-border text-sm"
    >
      <button class="page-btn" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">‹</button>
      <template v-for="p in pageRange" :key="p">
        <span v-if="p === '...'" class="px-2 text-gray-500">…</span>
        <button
          v-else
          class="page-btn"
          :class="p === currentPage ? 'bg-accent text-white border-accent' : ''"
          @click="goToPage(p as number)"
        >{{ p }}</button>
      </template>
      <button class="page-btn" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">›</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import type { SortBy, SortOrder } from '@/services/http/tasksApi'
import TaskRow from './TaskRow.vue'
import SortIcon from './SortIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const props = defineProps<{ templateFilter: string | null }>()
const emit = defineEmits<{ openTask: [id: string] }>()

const tasksStore = useTasksStore()

// ---- Local UI state ----
const searchInput = ref('')
const filtersVisible = ref(false)
const statusDropdownOpen = ref(false)
const templateDropdownOpen = ref(false)
const selectedStatusIds = ref<string[]>([])
const selectedTemplateId = ref<string | null>(props.templateFilter)

const statusDropdownEl = ref<HTMLElement | null>(null)
const templateDropdownEl = ref<HTMLElement | null>(null)
const assigneeDropdownEl = ref<HTMLElement | null>(null)

const selectedAssigneeIds = ref<string[]>([])
const assigneeDropdownOpen = ref(false)
const assigneeSearch = ref('')

// ---- Sort ----
const sortBy = ref<SortBy>('created_at')
const sortOrder = ref<SortOrder>('desc')

// ---- Grouping ----
const isGrouped = ref(false)

// ---- Pagination ----
const currentPage = computed(() => tasksStore.listParams.page ?? 1)
const pageSize = computed(() => tasksStore.listParams.page_size ?? 50)
const totalPages = computed(() => Math.max(1, Math.ceil(tasksStore.taskListTotal / pageSize.value)))

// ---- Derived ----
const selectedTemplatePrefix = computed(() =>
  tasksStore.activeTemplates.find(t => t.id === selectedTemplateId.value)?.prefix ?? '',
)

const hasAssigneeFields = computed(() => tasksStore.assigneeFieldIds.length > 0)

const userOptions = computed(() =>
  tasksStore.users.map(u => ({ value: u.id, label: u.display_name || u.email, avatarUrl: u.avatar_url })),
)

const filteredUserOptions = computed(() => {
  const q = assigneeSearch.value.trim().toLowerCase()
  return q ? userOptions.value.filter(o => o.label.toLowerCase().includes(q)) : userOptions.value
})

const activeFilterCount = computed(() =>
  (selectedStatusIds.value.length > 0 ? 1 : 0) +
  (selectedTemplateId.value ? 1 : 0) +
  (selectedAssigneeIds.value.length > 0 ? 1 : 0),
)

function statusName(id: string): string {
  return tasksStore.statusById(id)?.name ?? id
}

// ---- Search debounce ----
let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(applyParams, 300)
}

// ---- Actions ----

// Returns the single assignee field definition ID that is safe to filter on,
// or null when the filter cannot be expressed as a single EXISTS subquery.
function resolveAssigneeFieldId(): string | null {
  const ids = tasksStore.assigneeFieldIds

  // Template pinned → use that template's assignee field exclusively.
  if (selectedTemplateId.value) {
    const templateFields = tasksStore.activeFieldsFor(selectedTemplateId.value)
    return templateFields.find(f => f.field_role === 'assignee')?.id ?? null
  }

  // No template selected: only safe when there is exactly one assignee field
  // across the whole system (single-template setup or all templates share one).
  return ids.length === 1 ? ids[0] : null
}

function applyParams() {
  const prefix = selectedTemplateId.value
    ? tasksStore.activeTemplates.find(t => t.id === selectedTemplateId.value)?.prefix
    : undefined

  // Resolve the single assignee field ID to use for filtering.
  //
  // The backend ANDs every FieldFilter entry. Sending one entry per template's
  // assignee field would require a task to satisfy ALL of them simultaneously —
  // impossible, since a task only carries field values for its own template.
  //
  // Safe cases:
  //   - A specific template is selected → use that template's assignee field.
  //   - Exactly one assignee field exists system-wide → use it regardless of
  //     template selection (single-template setups, or all templates share one).
  //
  // Unsafe case (multiple templates, no template selected, each with its own
  // assignee field): no field filter is sent — the assignee chips remain visible
  // and selected, but the backend ignores them until the user pins a template.
  const resolvedAssigneeFieldId = resolveAssigneeFieldId()
  const fieldFilters =
    selectedAssigneeIds.value.length && resolvedAssigneeFieldId
      ? [{ field_definition_id: resolvedAssigneeFieldId, user_ids: selectedAssigneeIds.value }]
      : undefined

  tasksStore.setListParams({
    search: searchInput.value.trim() || undefined,
    status_ids: selectedStatusIds.value.length ? selectedStatusIds.value : undefined,
    prefixes: prefix ? [prefix] : undefined,
    field_filters: fieldFilters,
    sort_by: sortBy.value,
    sort_order: sortOrder.value,
    page: 1,
  })
}

function toggleSort(field: SortBy) {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortOrder.value = 'asc'
  }
  applyParams()
}

function toggleGroupBy() {
  isGrouped.value = !isGrouped.value
  // No query param needed — backend always returns groups; we just change the render mode
  tasksStore.loadTaskList()
}

function selectTemplate(id: string | null) {
  selectedTemplateId.value = id
  templateDropdownOpen.value = false
  applyParams()
}

function clearFilters() {
  selectedStatusIds.value = []
  selectedTemplateId.value = null
  selectedAssigneeIds.value = []
  applyParams()
}

function goToPage(page: number) {
  tasksStore.loadTaskList({ page })
}

// ---- Pagination range ----
const pageRange = computed<(number | '...')[]>(() => {
  const total = totalPages.value
  const current = currentPage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '...')[] = [1]
  if (current > 3) pages.push('...')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
})

// ---- Close dropdowns on outside click ----
function onDocClick(e: MouseEvent) {
  if (statusDropdownEl.value && !statusDropdownEl.value.contains(e.target as Node)) {
    statusDropdownOpen.value = false
  }
  if (templateDropdownEl.value && !templateDropdownEl.value.contains(e.target as Node)) {
    templateDropdownOpen.value = false
  }
  if (assigneeDropdownEl.value && !assigneeDropdownEl.value.contains(e.target as Node)) {
    assigneeDropdownOpen.value = false
  }
}

// Apply filters immediately when selection changes
watch(selectedStatusIds, () => applyParams(), { deep: true })
watch(selectedAssigneeIds, () => applyParams(), { deep: true })

// Sync templateFilter prop from sidebar
watch(() => props.templateFilter, (val) => {
  selectedTemplateId.value = val
  applyParams()
})

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  tasksStore.loadConfig().then(async () => {
    if (props.templateFilter !== null) {
      selectedTemplateId.value = props.templateFilter
    }
    // Load all template fields (to discover assignee field IDs) and users
    // in parallel with the initial task list fetch.
    await Promise.all([
      tasksStore.loadAllTemplateFields(),
      tasksStore.loadUsers(),
    ])
    applyParams()
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<style scoped>
.th {
  @apply px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer select-none hover:text-white transition-colors;
}
.toolbar-btn {
  @apply flex items-center gap-1.5 px-3 py-1.5 rounded border border-chat-border text-sm text-gray-300
         hover:text-white hover:border-accent/40 transition-colors;
}
.filter-chip {
  @apply flex items-center gap-1 px-2.5 py-1 rounded border border-chat-border text-xs text-gray-400
         hover:border-accent/50 hover:text-white transition-colors;
}
.filter-chip.active {
  @apply border-accent/60 text-accent;
}
.filter-chip-count {
  @apply ml-1 bg-accent text-white text-xs rounded-full px-1.5 py-0.5 leading-none;
}
.dropdown-menu {
  @apply absolute top-full left-0 mt-1 min-w-[160px] bg-chat-input border border-chat-border
         rounded shadow-xl z-30 py-1 max-h-60 overflow-y-auto;
}
.dropdown-item {
  @apply flex items-center px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10 cursor-pointer;
}
.page-btn {
  @apply w-8 h-8 flex items-center justify-center rounded border border-chat-border text-sm
         text-gray-300 hover:text-white hover:border-accent/40 transition-colors
         disabled:opacity-30 disabled:cursor-not-allowed;
}
</style>
