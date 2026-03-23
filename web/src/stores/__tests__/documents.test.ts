import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  documentsUpdateDocument: documentsApiMocks.documentsUpdateDocument,
  documentsUpdateTeamspace: documentsApiMocks.documentsUpdateTeamspace,
}))

describe('documents store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    documentsApiMocks.documentsDeleteTeamspace.mockResolvedValue(undefined)
    documentsApiMocks.documentsListTeamspaces.mockResolvedValue([])
    documentsApiMocks.documentsListSidebar.mockResolvedValue([])
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
})
