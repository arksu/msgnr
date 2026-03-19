import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  documentsCreateDocument,
  documentsCreateTeamspace,
  documentsGetDocument,
  documentsJoinTeamspace,
  documentsListDocumentHistory,
  documentsListSidebar,
  documentsListTeamspaces,
  documentsUpdateDocument,
  documentsUpdateTeamspace,
  type CreateDocumentPayload,
  type DocumentHistoryItem,
  type DocumentItem,
  type SidebarTeamspace,
  type Teamspace,
  type UpsertTeamspacePayload,
  type UpdateDocumentPayload,
} from '@/services/http/documentsApi'
import { tasksListUsers, type TaskUser } from '@/services/http/tasksApi'

export const useDocumentsStore = defineStore('documents', () => {
  const teamspaces = ref<Teamspace[]>([])
  const teamspacesLoading = ref(false)
  const teamspacesError = ref<string | null>(null)

  const sidebarTeamspaces = ref<SidebarTeamspace[]>([])
  const sidebarLoading = ref(false)
  const sidebarError = ref<string | null>(null)

  const selectedDocument = ref<DocumentItem | null>(null)
  const documentLoading = ref(false)
  const documentError = ref<string | null>(null)

  const users = ref<TaskUser[]>([])
  const usersLoaded = ref(false)
  const usersLoading = ref(false)

  const selectedDocumentRequestKey = ref('')

  const memberTeamspaces = computed(() => teamspaces.value.filter(item => item.is_member))

  async function loadTeamspaces(force = false) {
    if (teamspacesLoading.value) return
    if (!force && teamspaces.value.length > 0) return
    teamspacesLoading.value = true
    teamspacesError.value = null
    try {
      teamspaces.value = await documentsListTeamspaces()
    } catch (e) {
      teamspacesError.value = e instanceof Error ? e.message : 'Failed to load teamspaces'
    } finally {
      teamspacesLoading.value = false
    }
  }

  async function loadSidebar(force = false) {
    if (sidebarLoading.value) return
    if (!force && sidebarTeamspaces.value.length > 0) return
    sidebarLoading.value = true
    sidebarError.value = null
    try {
      sidebarTeamspaces.value = await documentsListSidebar()
    } catch (e) {
      sidebarError.value = e instanceof Error ? e.message : 'Failed to load documents sidebar'
    } finally {
      sidebarLoading.value = false
    }
  }

  async function loadUsers() {
    if (usersLoaded.value || usersLoading.value) return
    usersLoading.value = true
    try {
      users.value = await tasksListUsers()
      usersLoaded.value = true
    } finally {
      usersLoading.value = false
    }
  }

  async function selectDocument(id: string, forceRefresh = false) {
    if (!forceRefresh && selectedDocument.value?.id === id) return
    const requestKey = `${Date.now()}:${id}`
    selectedDocumentRequestKey.value = requestKey
    documentLoading.value = true
    documentError.value = null
    try {
      const documentItem = await documentsGetDocument(id)
      if (selectedDocumentRequestKey.value !== requestKey) return
      selectedDocument.value = documentItem
    } catch (e) {
      if (selectedDocumentRequestKey.value !== requestKey) return
      selectedDocument.value = null
      documentError.value = e instanceof Error ? e.message : 'Failed to load document'
    } finally {
      if (selectedDocumentRequestKey.value === requestKey) {
        documentLoading.value = false
      }
    }
  }

  function clearSelectedDocument() {
    selectedDocumentRequestKey.value = ''
    selectedDocument.value = null
    documentLoading.value = false
    documentError.value = null
  }

  async function createTeamspace(payload: UpsertTeamspacePayload) {
    const row = await documentsCreateTeamspace(payload)
    await Promise.all([loadTeamspaces(true), loadSidebar(true)])
    return row
  }

  async function updateTeamspace(id: string, payload: UpsertTeamspacePayload) {
    const row = await documentsUpdateTeamspace(id, payload)
    await Promise.all([loadTeamspaces(true), loadSidebar(true)])
    return row
  }

  async function joinTeamspace(id: string) {
    const row = await documentsJoinTeamspace(id)
    await Promise.all([loadTeamspaces(true), loadSidebar(true)])
    return row
  }

  async function createDocument(payload: CreateDocumentPayload) {
    const row = await documentsCreateDocument(payload)
    selectedDocument.value = row
    await loadSidebar(true)
    return row
  }

  async function updateDocument(id: string, payload: UpdateDocumentPayload) {
    const row = await documentsUpdateDocument(id, payload)
    if (selectedDocument.value?.id === id) {
      selectedDocument.value = row
    }
    await loadSidebar(true)
    return row
  }

  async function loadDocumentHistory(id: string): Promise<DocumentHistoryItem[]> {
    return documentsListDocumentHistory(id)
  }

  return {
    teamspaces,
    teamspacesLoading,
    teamspacesError,
    sidebarTeamspaces,
    sidebarLoading,
    sidebarError,
    selectedDocument,
    documentLoading,
    documentError,
    users,
    usersLoaded,
    memberTeamspaces,
    loadTeamspaces,
    loadSidebar,
    loadUsers,
    selectDocument,
    clearSelectedDocument,
    createTeamspace,
    updateTeamspace,
    joinTeamspace,
    createDocument,
    updateDocument,
    loadDocumentHistory,
  }
})
