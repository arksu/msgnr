import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
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
  tasksCreateSubtask,
  tasksListTasks,
  type TaskTemplate,
  type TaskStatus,
  type TaskFieldDefinition,
  type TaskUser,
  type EnumDictionaryVersionItem,
  type Task,
  type TaskListItem,
  type TaskListGroup,
  type TaskListParams,
  type SortOrder,
  type CreateTaskPayload,
  type UpdateTaskPayload,
} from '@/services/http/tasksApi'

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

  function setListParams(partial: Partial<TaskListParams>) {
    listParams.value = { ...listParams.value, ...partial, page: 1 }
    loadTaskList()
  }

  function resetListParams() {
    listParams.value = { page: 1, page_size: 50, sort_by: 'created_at', sort_order: 'desc' }
    loadTaskList()
  }

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
    taskListGroups,
    taskListTotal,
    taskListLoading,
    taskListError,
    listParams,
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
    createSubtask,
    clearSelectedTask,
    loadTaskList,
    setListParams,
    resetListParams,
  }
})
