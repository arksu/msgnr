import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentsSidebar from '@/components/documents/DocumentsSidebar.vue'

const documentsStoreMock = reactive({
  sidebarLoading: false,
  sidebarError: null as string | null,
  sidebarTeamspaces: [] as any[],
  favoriteDocuments: [] as any[],
  loadSidebar: vi.fn(async () => {}),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  favoriteDocument: vi.fn(async () => {}),
  unfavoriteDocument: vi.fn(async () => {}),
})

const storageMocks = vi.hoisted(() => ({
  collapsedTeamspaceIds: [] as string[],
  collapsedNodeIds: [] as string[],
  saveCollapsedDocumentsTeamspaceIds: vi.fn(),
  saveCollapsedDocumentsNodeIds: vi.fn(),
}))

vi.mock('@/stores/documents', () => ({
  useDocumentsStore: () => documentsStoreMock,
}))

vi.mock('@/services/storage/documentsTeamspaceCollapseStorage', () => ({
  loadCollapsedDocumentsTeamspaceIds: () => storageMocks.collapsedTeamspaceIds,
  saveCollapsedDocumentsTeamspaceIds: storageMocks.saveCollapsedDocumentsTeamspaceIds,
}))

vi.mock('@/services/storage/documentsNodeCollapseStorage', () => ({
  loadCollapsedDocumentsNodeIds: () => storageMocks.collapsedNodeIds,
  saveCollapsedDocumentsNodeIds: storageMocks.saveCollapsedDocumentsNodeIds,
}))

describe('DocumentsSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    documentsStoreMock.sidebarLoading = false
    documentsStoreMock.sidebarError = null
    documentsStoreMock.sidebarTeamspaces = []
    documentsStoreMock.favoriteDocuments = []
    storageMocks.collapsedTeamspaceIds = []
    storageMocks.collapsedNodeIds = []
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

  it('renders favorites and opens a favorite while expanding its sidebar path', async () => {
    storageMocks.collapsedTeamspaceIds = ['teamspace-1']
    storageMocks.collapsedNodeIds = ['root-doc']
    documentsStoreMock.sidebarTeamspaces = [
      {
        id: 'teamspace-1',
        name: 'Alpha',
        documents: [
          {
            id: 'root-doc',
            teamspace_id: 'teamspace-1',
            parent_document_id: null,
            title: 'Root',
            children: [
              {
                id: 'child-doc',
                teamspace_id: 'teamspace-1',
                parent_document_id: 'root-doc',
                title: 'Child',
                children: [],
              },
            ],
          },
        ],
      },
    ]
    documentsStoreMock.favoriteDocuments = [
      {
        id: 'child-doc',
        teamspace_id: 'teamspace-1',
        parent_document_id: 'root-doc',
        title: 'Child',
        favorited_at: '2026-05-22T00:00:00Z',
        ancestor_document_ids: ['root-doc'],
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

    expect(wrapper.get('[data-testid="documents-favorite-child-doc"]').text()).toContain('Child')
    expect(wrapper.find('[data-testid="documents-node-child-doc"]').exists()).toBe(false)

    await wrapper.get('[data-testid="documents-favorite-child-doc"]').trigger('click')

    expect(wrapper.emitted('openDocument')).toEqual([['child-doc']])
    expect(wrapper.find('[data-testid="documents-node-child-doc"]').exists()).toBe(true)
  })

  it('adds a document to favorites from the row menu', async () => {
    documentsStoreMock.sidebarTeamspaces = [
      {
        id: 'teamspace-1',
        name: 'Alpha',
        documents: [
          {
            id: 'doc-1',
            teamspace_id: 'teamspace-1',
            parent_document_id: null,
            title: 'Root',
            is_favorite: false,
            children: [],
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

    await wrapper.get('[data-testid="documents-node-menu-doc-1"]').trigger('click')
    await wrapper.get('[data-testid="documents-node-favorite-doc-1"]').trigger('click')
    await Promise.resolve()

    expect(documentsStoreMock.favoriteDocument).toHaveBeenCalledWith('doc-1')
  })
})
