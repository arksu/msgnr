import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentCard from '@/components/documents/DocumentCard.vue'

const platformMocks = vi.hoisted(() => ({
  getPlatformOrNull: vi.fn(),
  initPlatform: vi.fn(),
  exportDocumentToPdfBlob: vi.fn(),
  buildDocumentPdfFileName: vi.fn(),
}))

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

vi.mock('@/platform', () => ({
  getPlatformOrNull: platformMocks.getPlatformOrNull,
  initPlatform: platformMocks.initPlatform,
}))

vi.mock('@/services/taskPdfExport', () => ({
  exportDocumentToPdfBlob: platformMocks.exportDocumentToPdfBlob,
  buildDocumentPdfFileName: platformMocks.buildDocumentPdfFileName,
}))

describe('DocumentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const platform = {
      files: {
        saveBlob: vi.fn(async () => ({ saved: true })),
      },
    }
    platformMocks.getPlatformOrNull.mockReturnValue(platform)
    platformMocks.initPlatform.mockResolvedValue(platform)
    platformMocks.exportDocumentToPdfBlob.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
    platformMocks.buildDocumentPdfFileName.mockReturnValue('Design doc.pdf')
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

  it('exports the current document to PDF through the platform adapter', async () => {
    const wrapper = mount(DocumentCard, {
      global: {
        stubs: {
          UserAvatar: true,
          Teleport: true,
          TaskDescriptionEditor: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<textarea data-testid="document-content-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="document-content-stub"]').setValue('## Updated content')
    await wrapper.get('[data-testid="document-export-pdf"]').trigger('click')
    await flushPromises()

    expect(platformMocks.exportDocumentToPdfBlob).toHaveBeenCalledWith({
      title: 'Design doc',
      content_markdown: '## Updated content',
    })
    const platform = platformMocks.getPlatformOrNull.mock.results[0]?.value
    expect(platform.files.saveBlob).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'Design doc.pdf',
      mimeType: 'application/pdf',
    }))
  })
})
