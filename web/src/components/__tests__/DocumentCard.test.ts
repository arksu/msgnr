import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentCard from '@/components/documents/DocumentCard.vue'

const documentsStoreMock = reactive({
  selectedDocument: null as null | {
    id: string
    teamspace_id: string
    teamspace_name: string
    parent_document_id: string | null
    parent_title: string | null
    title: string
    content_markdown: string | null
    created_by: string
    updated_by: string
    created_at: string
    updated_at: string
  },
  documentLoading: false,
  documentError: null as string | null,
  sidebarTeamspaces: [] as Array<{
    id: string
    name: string
    documents: Array<{
      id: string
      teamspace_id: string
      parent_document_id: string | null
      title: string
      children: any[]
    }>
  }>,
  loadDocumentHistory: vi.fn(async () => []),
  updateDocument: vi.fn(async (id: string, payload: Record<string, unknown>) => ({
    id,
    teamspace_id: 'teamspace-1',
    teamspace_name: 'Alpha',
    parent_document_id: 'doc-2',
    parent_title: 'Section',
    title: (payload.title as string) ?? 'Design doc',
    content_markdown: (payload.content_markdown as string | null) ?? 'Body',
    created_by: 'u-1',
    updated_by: 'u-1',
    created_at: '2026-03-10T12:00:00Z',
    updated_at: '2026-03-10T12:00:00Z',
  })),
})

vi.mock('@/stores/documents', () => ({
  useDocumentsStore: () => documentsStoreMock,
}))

describe('DocumentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    documentsStoreMock.selectedDocument = {
      id: 'doc-3',
      teamspace_id: 'teamspace-1',
      teamspace_name: 'Alpha',
      parent_document_id: 'doc-2',
      parent_title: 'Section',
      title: 'Design doc',
      content_markdown: 'Body',
      created_by: 'u-1',
      updated_by: 'u-1',
      created_at: '2026-03-10T12:00:00Z',
      updated_at: '2026-03-10T12:00:00Z',
    }
    documentsStoreMock.sidebarTeamspaces = [
      {
        id: 'teamspace-1',
        name: 'Alpha',
        documents: [
          {
            id: 'doc-1',
            teamspace_id: 'teamspace-1',
            parent_document_id: null,
            title: 'Projects',
            children: [
              {
                id: 'doc-2',
                teamspace_id: 'teamspace-1',
                parent_document_id: 'doc-1',
                title: 'Section',
                children: [
                  {
                    id: 'doc-3',
                    teamspace_id: 'teamspace-1',
                    parent_document_id: 'doc-2',
                    title: 'Design doc',
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]
  })

  it('shows the full teamspace-to-document breadcrumb in the header', async () => {
    const wrapper = mount(DocumentCard, {
      global: {
        stubs: {
          TaskDescriptionEditor: true,
          UserAvatar: true,
          Teleport: true,
        },
      },
    })
    await flushPromises()

    const breadcrumb = wrapper.get('[data-testid="document-breadcrumb"]')
    expect(breadcrumb.text()).toContain('Alpha')
    expect(breadcrumb.text()).toContain('Projects')
    expect(breadcrumb.text()).toContain('Section')
    expect(breadcrumb.text()).toContain('Design doc')
  })
})
