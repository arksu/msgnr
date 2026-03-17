import { defineStore } from 'pinia'
import { ref, computed, readonly } from 'vue'
import {
  tasksListTemplates,
  tasksListStatuses,
  tasksListFields,
  tasksListUsers,
  tasksGetDictionaryVersionItems,
  tasksListDictionaryVersions,
  tasksCreate,
  tasksGet,
  tasksUpdate,
  tasksUpdateTaskTitle,
  tasksUpdateTaskStatus,
  tasksUpdateTaskDescription,
  tasksUpdateTaskFieldValue,
  tasksCreateSubtask,
  tasksListTasks,
  tasksListGrouped,
  tasksListStatusPortion,
  type TaskTemplate,
  type TaskStatus,
  type TaskFieldDefinition,
  type TaskUser,
  type EnumDictionaryVersionItem,
  type Task,
  type TaskFieldValue,
  type TaskListItem,
  type TaskListGroup,
  type TaskListParams,
  type TaskGroupedStatusBucket,
  type SortOrder,
  type CreateTaskPayload,
  type UpdateTaskPayload,
  type UpdateTaskTitlePayload,
} from '@/services/http/tasksApi'

const DEBUG_TASKS_DESC = import.meta.env.DEV

function descriptionSignature(value: string | null | undefined): string {
  if (value == null) return 'null'
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  const preview = value.slice(0, 80).replace(/\n/g, '\\n')
  return `len=${value.length},hash=${hash},preview="${preview}"`
}

function tasksDescLog(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_TASKS_DESC) return
  console.debug('[tasks-store-desc]', event, payload)
}

type TaskListLoadMode = 'list' | 'grouped'

type GroupedTaskGroupState = TaskGroupedStatusBucket & {
  next_offset: number
  has_more: boolean
  loading_more: boolean
  load_more_error: string | null
}

export const useTasksStore = defineStore('tasks', () => {
  // ---- Config (templates, statuses, fields) ----
  const templates = ref<TaskTemplate[]>([])
  const statuses = ref<TaskStatus[]>([])
  const fieldsByTemplate = ref<Record<string, TaskFieldDefinition[]>>({})
  const configLoaded = ref(false)
  const configLoading = ref(false)
  const configError = ref<string | null>(null)

  // ---- Shared lookup data ----
  // Loaded once; injected into field inputs via props so there are no per-instance fetches.
  const users = ref<TaskUser[]>([])
  const usersLoaded = ref(false)
  // enum items keyed by dictionary_id (always latest version)
  const enumItemsByDict = ref<Record<string, EnumDictionaryVersionItem[]>>({})
  // version number loaded for each dictionary_id
  const enumVersionByDict = ref<Record<string, number>>({})

  // ---- Selected task ----
  const selectedTask = ref<Task | null>(null)
  const taskLoading = ref(false)
  const taskError = ref<string | null>(null)

  // ---- Create dialog ----
  const createDialogOpen = ref(false)

  // ---- Task list ----
  // The backend always returns a grouped response. The flat list is derived
  // from groups so both flat and grouped views share the same data.
  const taskListGroups = ref<TaskListGroup[]>([])
  const taskListTotal = ref(0)
  const taskListLoading = ref(false)
  const taskListError = ref<string | null>(null)
  const listParams = ref<TaskListParams>({
    page: 1,
    page_size: 50,
    sort_by: 'created_at',
    sort_order: 'desc' as SortOrder,
  })

  // Grouped mode (GET /api/tasks/grouped + /api/tasks/status/:id/portion)
  const groupedTaskStatusOrder = ref<string[]>([])
  const groupedTaskGroupsByStatus = ref<Record<string, GroupedTaskGroupState>>({})
  const groupedTaskPortionLimit = ref(50)

  // Flat list derived from all group pages currently loaded
  const taskList = computed<TaskListItem[]>(() =>
    taskListGroups.value.flatMap(g => g.tasks),
  )

  // ---- Derived ----
  const activeTemplates = computed(() =>
    templates.value.filter(t => !t.deleted_at).sort((a, b) => a.sort_order - b.sort_order),
  )

  const activeStatuses = computed(() =>
    statuses.value.filter(s => !s.deleted_at).sort((a, b) => a.sort_order - b.sort_order),
  )

  function allStatuses(): TaskStatus[] {
    return statuses.value.slice().sort((a, b) => a.sort_order - b.sort_order)
  }

  function activeFieldsFor(templateId: string): TaskFieldDefinition[] {
    return (fieldsByTemplate.value[templateId] ?? [])
      .filter(f => !f.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order)
  }

  // All active assignee field definition IDs across every loaded template.
  // Used by the task list assignee filter to build field_<uuid>_user params.
  const assigneeFieldIds = computed<string[]>(() =>
    Object.values(fieldsByTemplate.value)
      .flat()
      .filter(f => f.field_role === 'assignee' && !f.deleted_at)
      .map(f => f.id),
  )

  function statusById(id: string): TaskStatus | undefined {
    return statuses.value.find(s => s.id === id)
  }

  function templateById(id: string): TaskTemplate | undefined {
    return templates.value.find(t => t.id === id)
  }

  function enumItemsFor(dictionaryId: string): EnumDictionaryVersionItem[] {
    return enumItemsByDict.value[dictionaryId] ?? []
  }

  function listFilterParams(): TaskListParams {
    return {
      search: listParams.value.search,
      status_ids: listParams.value.status_ids,
      prefixes: listParams.value.prefixes,
      field_filters: listParams.value.field_filters,
    }
  }

  function replaceGroupedStatusState(statusId: string, next: GroupedTaskGroupState) {
    groupedTaskGroupsByStatus.value = {
      ...groupedTaskGroupsByStatus.value,
      [statusId]: next,
    }
  }

  // ---- Actions ----

  async function loadConfig() {
    if (configLoaded.value || configLoading.value) return
    configLoading.value = true
    configError.value = null
    try {
      const [tpls, sts] = await Promise.all([
        tasksListTemplates(false),
        tasksListStatuses(false),
      ])
      templates.value = tpls
      statuses.value = sts
      configLoaded.value = true
    } catch (e) {
      configError.value = e instanceof Error ? e.message : 'Failed to load configuration'
    } finally {
      configLoading.value = false
    }
  }

  async function loadFieldsFor(templateId: string) {
    if (fieldsByTemplate.value[templateId]) return
    try {
      const fields = await tasksListFields(templateId, false)
      fieldsByTemplate.value = { ...fieldsByTemplate.value, [templateId]: fields }
    } catch {
      // non-fatal — fields just won't render
    }
  }

  // Loads fields for every active template in parallel.
  // Needed by the task list to discover all assignee field IDs upfront.
  async function loadAllTemplateFields() {
    await Promise.all(activeTemplates.value.map(t => loadFieldsFor(t.id)))
  }

  async function loadUsers() {
    if (usersLoaded.value) return
    try {
      users.value = await tasksListUsers()
      usersLoaded.value = true
    } catch {
      // non-fatal — user selectors will be empty
    }
  }

  async function loadEnumItemsFor(dictionaryId: string) {
    if (enumItemsByDict.value[dictionaryId]) return
    try {
      const versions = await tasksListDictionaryVersions(dictionaryId)
      if (versions.length === 0) return
      const latest = versions.reduce((a, b) => (a.version > b.version ? a : b))
      const items = await tasksGetDictionaryVersionItems(dictionaryId, latest.id)
      enumItemsByDict.value = { ...enumItemsByDict.value, [dictionaryId]: items }
      enumVersionByDict.value = { ...enumVersionByDict.value, [dictionaryId]: latest.version }
    } catch {
      // non-fatal
    }
  }

  function enumVersionFor(dictionaryId: string): number | undefined {
    return enumVersionByDict.value[dictionaryId]
  }

  function openCreateDialog() {
    createDialogOpen.value = true
  }

  function closeCreateDialog() {
    createDialogOpen.value = false
  }

  async function createTask(payload: CreateTaskPayload): Promise<Task> {
    const task = await tasksCreate(payload)
    selectedTask.value = task
    return task
  }

  async function selectTask(id: string, forceRefresh = false) {
    if (!forceRefresh && selectedTask.value?.id === id) return
    taskLoading.value = true
    taskError.value = null
    try {
      selectedTask.value = await tasksGet(id)
      tasksDescLog('selectTask:loaded', {
        id,
        forceRefresh,
        description: descriptionSignature(selectedTask.value.description),
        updatedAt: selectedTask.value.updated_at,
      })
      await loadFieldsFor(selectedTask.value.template_id)
    } catch (e) {
      taskError.value = e instanceof Error ? e.message : 'Failed to load task'
    } finally {
      taskLoading.value = false
    }
  }

  async function updateTask(id: string, payload: UpdateTaskPayload): Promise<Task> {
    const updated = await tasksUpdate(id, payload)
    selectedTask.value = updated
    return updated
  }

  async function updateTaskTitle(id: string, payload: UpdateTaskTitlePayload): Promise<Task> {
    const updated = await tasksUpdateTaskTitle(id, payload)
    selectedTask.value = updated
    return updated
  }

  async function updateTaskStatus(id: string, statusId: string): Promise<Task> {
    const updated = await tasksUpdateTaskStatus(id, { status_id: statusId })
    selectedTask.value = updated
    return updated
  }

  async function updateTaskDescription(id: string, description: string | null): Promise<Task> {
    tasksDescLog('updateTaskDescription:start', {
      id,
      request: descriptionSignature(description),
      beforeSelected: selectedTask.value?.id === id
        ? descriptionSignature(selectedTask.value.description)
        : 'not-selected',
    })
    const updated = await tasksUpdateTaskDescription(id, { description })
    tasksDescLog('updateTaskDescription:response', {
      id,
      response: descriptionSignature(updated.description),
      updatedAt: updated.updated_at,
    })
    if (selectedTask.value?.id === id) {
      selectedTask.value = updated
    } else {
      tasksDescLog('updateTaskDescription:stale-response-ignored', {
        id,
        selectedTaskId: selectedTask.value?.id ?? null,
        response: descriptionSignature(updated.description),
      })
    }
    return updated
  }

  async function updateTaskFieldValue(
    taskId: string,
    fieldId: string,
    payload: {
      value_text?: string | null
      value_number?: string | null
      value_user_id?: string | null
      value_date?: string | null
      value_datetime?: string | null
      value_json?: unknown | null
      enum_dictionary_id?: string | null
      enum_version?: number | null
    },
  ): Promise<TaskFieldValue> {
    const updated = await tasksUpdateTaskFieldValue(taskId, fieldId, payload)
    if (selectedTask.value?.id === taskId) {
      const idx = selectedTask.value.field_values.findIndex(v => v.field_definition_id === fieldId)
      if (idx >= 0) {
        selectedTask.value.field_values[idx] = updated
      } else {
        selectedTask.value.field_values.push(updated)
      }
    }
    return updated
  }

  async function createSubtask(parentId: string, payload: CreateTaskPayload): Promise<Task> {
    const subtask = await tasksCreateSubtask(parentId, payload)
    // Force-refresh the parent so its subtasks list reflects the new entry,
    // even if the parent was the previously selected task.
    await selectTask(parentId, true)
    return subtask
  }

  function clearSelectedTask() {
    selectedTask.value = null
    taskError.value = null
  }

  async function loadTaskList(overrides?: Partial<TaskListParams>) {
    if (overrides) {
      listParams.value = { ...listParams.value, ...overrides }
    }
    taskListLoading.value = true
    taskListError.value = null
    try {
      const res = await tasksListTasks(listParams.value)
      taskListGroups.value = res.groups ?? []
      taskListTotal.value = res.grand_total ?? 0
    } catch (e) {
      taskListError.value = e instanceof Error ? e.message : 'Failed to load tasks'
    } finally {
      taskListLoading.value = false
    }
  }

  async function loadGroupedTaskList(overrides?: Partial<TaskListParams>, limitOverride?: number) {
    if (overrides) {
      listParams.value = { ...listParams.value, ...overrides }
    }
    taskListLoading.value = true
    taskListError.value = null
    try {
      const res = await tasksListGrouped(listFilterParams(), limitOverride)
      const groupedMap = res.groups_by_status ?? {}
      const order = res.status_order ?? []
      const nextByStatus: Record<string, GroupedTaskGroupState> = {}

      for (const statusId of order) {
        const bucket = groupedMap[statusId]
        if (!bucket) continue
        const items = bucket.items ?? []
        nextByStatus[statusId] = {
          ...bucket,
          items,
          next_offset: items.length,
          has_more: items.length < bucket.total,
          loading_more: false,
          load_more_error: null,
        }
      }

      // Keep response robust when map has keys that are not present in status_order.
      for (const [statusId, bucket] of Object.entries(groupedMap)) {
        if (nextByStatus[statusId]) continue
        const items = bucket.items ?? []
        nextByStatus[statusId] = {
          ...bucket,
          items,
          next_offset: items.length,
          has_more: items.length < bucket.total,
          loading_more: false,
          load_more_error: null,
        }
      }

      groupedTaskStatusOrder.value = order
      groupedTaskGroupsByStatus.value = nextByStatus
      groupedTaskPortionLimit.value = res.limit ?? (limitOverride ?? groupedTaskPortionLimit.value)
      taskListTotal.value = res.grand_total ?? 0
    } catch (e) {
      taskListError.value = e instanceof Error ? e.message : 'Failed to load grouped tasks'
    } finally {
      taskListLoading.value = false
    }
  }

  async function loadMoreGroupedStatus(statusId: string) {
    const current = groupedTaskGroupsByStatus.value[statusId]
    if (!current || current.loading_more || !current.has_more) return

    replaceGroupedStatusState(statusId, { ...current, loading_more: true, load_more_error: null })
    try {
      const res = await tasksListStatusPortion(
        statusId,
        listFilterParams(),
        current.next_offset,
        groupedTaskPortionLimit.value,
      )
      const latest = groupedTaskGroupsByStatus.value[statusId]
      if (!latest) return
      replaceGroupedStatusState(statusId, {
        ...latest,
        items: [...latest.items, ...(res.items ?? [])],
        total: res.total ?? latest.total,
        next_offset: res.next_offset ?? (latest.next_offset + (res.items?.length ?? 0)),
        has_more: res.has_more ?? false,
        loading_more: false,
        load_more_error: null,
      })
    } catch (e) {
      const latest = groupedTaskGroupsByStatus.value[statusId]
      if (latest) {
        replaceGroupedStatusState(statusId, {
          ...latest,
          loading_more: false,
          load_more_error: e instanceof Error ? e.message : 'Failed to load more tasks',
        })
      }
    }
  }

  function setListParams(partial: Partial<TaskListParams>, mode: TaskListLoadMode = 'list') {
    listParams.value = { ...listParams.value, ...partial, page: 1 }
    if (mode === 'grouped') {
      loadGroupedTaskList()
      return
    }
    loadTaskList()
  }

  function resetListParams(mode: TaskListLoadMode = 'list') {
    listParams.value = { page: 1, page_size: 50, sort_by: 'created_at', sort_order: 'desc' }
    if (mode === 'grouped') {
      loadGroupedTaskList()
      return
    }
    loadTaskList()
  }

  function resetRuntimeState() {
    templates.value = []
    statuses.value = []
    fieldsByTemplate.value = {}
    configLoaded.value = false
    configLoading.value = false
    configError.value = null

    users.value = []
    usersLoaded.value = false
    enumItemsByDict.value = {}
    enumVersionByDict.value = {}

    selectedTask.value = null
    taskLoading.value = false
    taskError.value = null
    createDialogOpen.value = false

    taskListGroups.value = []
    groupedTaskStatusOrder.value = []
    groupedTaskGroupsByStatus.value = {}
    groupedTaskPortionLimit.value = 50
    taskListTotal.value = 0
    taskListLoading.value = false
    taskListError.value = null
    listParams.value = {
      page: 1,
      page_size: 50,
      sort_by: 'created_at',
      sort_order: 'desc',
    }
  }

  const taskListGroupsReadonly = readonly(taskListGroups)
  const groupedTaskStatusOrderReadonly = readonly(groupedTaskStatusOrder)
  const groupedTaskGroupsByStatusReadonly = readonly(groupedTaskGroupsByStatus)
  const groupedTaskPortionLimitReadonly = readonly(groupedTaskPortionLimit)
  const listParamsReadonly = readonly(listParams)

  return {
    // state
    templates,
    statuses,
    fieldsByTemplate,
    configLoaded,
    configLoading,
    configError,
    users,
    enumItemsByDict,
    selectedTask,
    taskLoading,
    taskError,
    createDialogOpen,
    taskList,
    taskListGroups: taskListGroupsReadonly,
    groupedTaskStatusOrder: groupedTaskStatusOrderReadonly,
    groupedTaskGroupsByStatus: groupedTaskGroupsByStatusReadonly,
    groupedTaskPortionLimit: groupedTaskPortionLimitReadonly,
    taskListTotal,
    taskListLoading,
    taskListError,
    listParams: listParamsReadonly,
    // derived
    activeTemplates,
    activeStatuses,
    allStatuses,
    activeFieldsFor,
    assigneeFieldIds,
    statusById,
    templateById,
    enumItemsFor,
    enumVersionFor,
    // actions
    loadConfig,
    loadFieldsFor,
    loadAllTemplateFields,
    loadUsers,
    loadEnumItemsFor,
    openCreateDialog,
    closeCreateDialog,
    createTask,
    selectTask,
    updateTask,
    updateTaskTitle,
    updateTaskStatus,
    updateTaskDescription,
    updateTaskFieldValue,
    createSubtask,
    clearSelectedTask,
    loadTaskList,
    loadGroupedTaskList,
    loadMoreGroupedStatus,
    setListParams,
    resetListParams,
    resetRuntimeState,
  }
})
