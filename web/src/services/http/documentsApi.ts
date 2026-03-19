import { AxiosError } from 'axios'
import { createAuthenticatedClient } from './client'

const http = createAuthenticatedClient()

export class DocumentsApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'DocumentsApiError'
  }
}

function handleError(e: unknown): never {
  if (e instanceof AxiosError && e.response) {
    const message: string = e.response.data?.error ?? e.response.statusText
    throw new DocumentsApiError(message, e.response.status)
  }
  throw new DocumentsApiError('Network error', 0)
}

async function apiCall<T>(request: Promise<{ data: T }>): Promise<T> {
  try {
    const { data } = await request
    return data
  } catch (e) { handleError(e) }
}

export interface TeamspaceMemberPreview {
  id: string
  display_name: string
  avatar_url: string
}

export interface Teamspace {
  id: string
  name: string
  owner_user_id: string
  is_private: boolean
  is_member: boolean
  is_owner: boolean
  can_manage: boolean
  member_count: number
  members: TeamspaceMemberPreview[]
  created_at: string
  updated_at: string
}

export interface SidebarDocumentNode {
  id: string
  teamspace_id: string
  parent_document_id: string | null
  title: string
  children: SidebarDocumentNode[]
}

export interface SidebarTeamspace {
  id: string
  name: string
  documents: SidebarDocumentNode[]
}

export interface DocumentItem {
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
}

export interface DocumentHistoryEditor {
  id: string
  display_name: string
  avatar_url: string
}

export interface DocumentHistoryItem {
  title: string
  content_markdown: string | null
  edited_by: string
  created_at: string
  editor: DocumentHistoryEditor
}

export interface UpsertTeamspacePayload {
  name: string
  is_private: boolean
  member_ids: string[]
}

export interface CreateDocumentPayload {
  teamspace_id: string
  parent_document_id?: string | null
  title: string
  content_markdown?: string | null
}

export interface UpdateDocumentPayload {
  title?: string
  content_markdown?: string | null
}

export async function documentsListTeamspaces(): Promise<Teamspace[]> {
  return apiCall(http.get<Teamspace[]>('/api/documents/teamspaces'))
}

export async function documentsCreateTeamspace(payload: UpsertTeamspacePayload): Promise<Teamspace> {
  return apiCall(http.post<Teamspace>('/api/documents/teamspaces', payload))
}

export async function documentsUpdateTeamspace(id: string, payload: UpsertTeamspacePayload): Promise<Teamspace> {
  return apiCall(http.patch<Teamspace>(`/api/documents/teamspaces/${id}`, payload))
}

export async function documentsJoinTeamspace(id: string): Promise<Teamspace> {
  return apiCall(http.post<Teamspace>(`/api/documents/teamspaces/${id}/join`))
}

export async function documentsListSidebar(): Promise<SidebarTeamspace[]> {
  return apiCall(http.get<SidebarTeamspace[]>('/api/documents/sidebar'))
}

export async function documentsCreateDocument(payload: CreateDocumentPayload): Promise<DocumentItem> {
  return apiCall(http.post<DocumentItem>('/api/documents', payload))
}

export async function documentsGetDocument(id: string): Promise<DocumentItem> {
  return apiCall(http.get<DocumentItem>(`/api/documents/${id}`))
}

export async function documentsUpdateDocument(id: string, payload: UpdateDocumentPayload): Promise<DocumentItem> {
  return apiCall(http.patch<DocumentItem>(`/api/documents/${id}`, payload))
}

export async function documentsListDocumentHistory(id: string): Promise<DocumentHistoryItem[]> {
  return apiCall(http.get<DocumentHistoryItem[]>(`/api/documents/${id}/history`))
}
