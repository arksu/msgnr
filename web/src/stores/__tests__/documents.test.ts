import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentsStore } from '@/stores/documents'

const documentsApiMocks = vi.hoisted(() => ({
  documentsCreateDocument: vi.fn(),
  documentsCreateTeamspace: vi.fn(),
  documentsDeleteDocument: vi.fn(),
  documentsDeleteTeamspace: vi.fn(),
  documentsGetDocument: vi.fn(),
  documentsJoinTeamspace: vi.fn(),
  documentsListDocumentHistory: vi.fn(),
  documentsListSidebar: vi.fn(),
  documentsListTeamspaces: vi.fn(),
  documentsSearchDocuments: vi.fn(),
  documentsUpdateDocument: vi.fn(),
  documentsUpdateTeamspace: vi.fn(),
}))

vi.mock('@/services/http/documentsApi', () => ({
  documentsCreateDocument: documentsApiMocks.documentsCreateDocument,
  documentsCreateTeamspace: documentsApiMocks.documentsCreateTeamspace,
  documentsDeleteDocument: documentsApiMocks.documentsDeleteDocument,
  documentsDeleteTeamspace: documentsApiMocks.documentsDeleteTeamspace,
  documentsGetDocument: documentsApiMocks.documentsGetDocument,
  documentsJoinTeamspace: documentsApiMocks.documentsJoinTeamspace,
  documentsListDocumentHistory: documentsApiMocks.documentsListDocumentHistory,
  documentsListSidebar: documentsApiMocks.documentsListSidebar,
  documentsListTeamspaces: documentsApiMocks.documentsListTeamspaces,
  documentsSearchDocuments: documentsApiMocks.documentsSearchDocuments,
  documentsUpdateDocument: documentsApiMocks.documentsUpdateDocument,
  documentsUpdateTeamspace: documentsApiMocks.documentsUpdateTeamspace,
}))

describe('documents store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    documentsApiMocks.documentsDeleteTeamspace.mockResolvedValue(undefined)
    documentsApiMocks.documentsListTeamspaces.mockResolvedValue([])
    documentsApiMocks.documentsListSidebar.mockResolvedValue([])
    documentsApiMocks.documentsSearchDocuments.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the selected document when its teamspace is deleted', async () => {
    const store = useDocumentsStore()
    store.selectedDocument = {
      id: 'doc-1',
      teamspace_id: 'teamspace-1',
    } as any

    await store.deleteTeamspace('teamspace-1')

    expect(documentsApiMocks.documentsDeleteTeamspace).toHaveBeenCalledWith('teamspace-1')
    expect(store.selectedDocument).toBeNull()
  })

  it('debounces document search requests and stores results', async () => {
    const store = useDocumentsStore()
    documentsApiMocks.documentsSearchDocuments.mockResolvedValue([
      {
        id: 'doc-1',
        teamspace_id: 'teamspace-1',
        teamspace_name: 'Alpha',
        title: 'Spec',
        snippet: 'Spec details',
      },
    ])

    store.scheduleSearch('spec')
    store.scheduleSearch('specification')

    expect(documentsApiMocks.documentsSearchDocuments).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()

    expect(documentsApiMocks.documentsSearchDocuments).toHaveBeenCalledTimes(1)
    expect(documentsApiMocks.documentsSearchDocuments).toHaveBeenCalledWith('specification')
    expect(store.searchResults).toEqual([
      expect.objectContaining({ id: 'doc-1', title: 'Spec' }),
    ])
  })

  it('clears pending search state when query is blank', async () => {
    const store = useDocumentsStore()
    store.searchResults = [
      {
        id: 'doc-1',
        teamspace_id: 'teamspace-1',
        teamspace_name: 'Alpha',
        title: 'Spec',
        snippet: 'Spec details',
      },
    ] as any

    store.scheduleSearch('   ')
    await vi.advanceTimersByTimeAsync(250)

    expect(documentsApiMocks.documentsSearchDocuments).not.toHaveBeenCalled()
    expect(store.searchResults).toEqual([])
    expect(store.searchError).toBeNull()
    expect(store.searchLoading).toBe(false)
  })
})
