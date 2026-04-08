import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentsSidebar from '@/components/documents/DocumentsSidebar.vue'

const documentsStoreMock = reactive({
  sidebarLoading: false,
  sidebarError: null as string | null,
  sidebarTeamspaces: [] as any[],
  loadSidebar: vi.fn(async () => {}),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
})

vi.mock('@/stores/documents', () => ({
  useDocumentsStore: () => documentsStoreMock,
}))

vi.mock('@/services/storage/documentsTeamspaceCollapseStorage', () => ({
  loadCollapsedDocumentsTeamspaceIds: () => [],
  saveCollapsedDocumentsTeamspaceIds: vi.fn(),
}))

vi.mock('@/services/storage/documentsNodeCollapseStorage', () => ({
  loadCollapsedDocumentsNodeIds: () => [],
  saveCollapsedDocumentsNodeIds: vi.fn(),
}))

describe('DocumentsSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    documentsStoreMock.sidebarLoading = false
    documentsStoreMock.sidebarError = null
    documentsStoreMock.sidebarTeamspaces = []
  })

  it('tolerates null documents and null children in sidebar payloads', () => {
    documentsStoreMock.sidebarTeamspaces = [
      {
        id: 'teamspace-1',
        name: 'Alpha',
        documents: null,
      },
      {
        id: 'teamspace-2',
        name: 'Beta',
        documents: [
          {
            id: 'doc-1',
            teamspace_id: 'teamspace-2',
            parent_document_id: null,
            title: 'Root',
            children: null,
          },
        ],
      },
    ]

    const wrapper = mount(DocumentsSidebar, {
      props: {
        selectedTeamspaceId: null,
        selectedDocumentId: null,
        searchQuery: '',
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('Beta')
    expect(wrapper.text()).toContain('Root')
  })

  it('emits search query changes from the header input', async () => {
    const wrapper = mount(DocumentsSidebar, {
      props: {
        selectedTeamspaceId: null,
        selectedDocumentId: null,
        searchQuery: '',
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })

    await wrapper.get('[data-testid="documents-search-input"]').setValue('spec')

    expect(wrapper.emitted('searchQueryChange')).toEqual([['spec']])
  })
})
