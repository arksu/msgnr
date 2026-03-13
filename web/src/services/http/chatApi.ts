import { AxiosError } from 'axios'
import type { AxiosProgressEvent } from 'axios'
import { createAuthenticatedClient } from './client'

const http = createAuthenticatedClient()

export class ChatApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ChatApiError'
  }
}

function handleError(e: unknown): never {
  if (e instanceof AxiosError && e.response) {
    const msg: string = e.response.data?.error ?? e.response.statusText
    throw new ChatApiError(msg, e.response.status)
  }
  throw new ChatApiError('Network error', 0)
}

export interface ChannelItem {
  id: string
  name: string
  kind: string
  visibility: string
  last_activity_at: string
}

export async function listChannels(): Promise<ChannelItem[]> {
  try {
    const { data } = await http.get<ChannelItem[]>('/api/channels')
    return data
  } catch (e) { handleError(e) }
}

export async function listAvailableChannels(): Promise<ChannelItem[]> {
  try {
    const { data } = await http.get<ChannelItem[]>('/api/channels/available')
    return data
  } catch (e) { handleError(e) }
}

export async function joinChannels(channelIds: string[]): Promise<ChannelItem[]> {
  try {
    const { data } = await http.post<ChannelItem[]>('/api/channels/join', { channel_ids: channelIds })
    return data
  } catch (e) { handleError(e) }
}

export async function leaveConversation(conversationId: string): Promise<void> {
  try {
    await http.post('/api/conversations/leave', { conversation_id: conversationId })
  } catch (e) { handleError(e) }
}

export interface DmCandidateItem {
  user_id: string
  display_name: string
  email: string
  avatar_url: string
}

export interface ConversationMemberItem {
  user_id: string
  display_name: string
  email: string
  avatar_url: string
}

export interface DirectMessageItem {
  conversation_id: string
  user_id: string
  display_name: string
  email: string
  avatar_url: string
  kind: string
  visibility: string
}

export interface ConversationMessageItem {
  id: string
  conversation_id: string
  sender_id: string
  sender_name: string
  body: string
  channel_seq: string | number
  thread_seq: string | number
  thread_root_message_id: string
  thread_reply_count?: number
  mention_everyone: boolean
  created_at: string
  reactions?: Array<{ emoji: string; count: number }>
  my_reactions?: string[]
  attachments?: ChatMessageAttachmentItem[]
}

export interface ChatMessageAttachmentItem {
  id: string
  file_name: string
  file_size: number
  mime_type: string
}

export interface ConversationHistoryPage {
  messages: ConversationMessageItem[]
  has_more: boolean
  page_size: number
  next_before_channel_seq?: string
}

export interface ReactionUserItem {
  user_id: string
  display_name: string
  avatar_url: string
}

interface ReactionUsersResponse {
  users: ReactionUserItem[]
}

export async function listDmCandidates(): Promise<DmCandidateItem[]> {
  try {
    const { data } = await http.get<DmCandidateItem[]>('/api/dm-candidates')
    return data
  } catch (e) { handleError(e) }
}

export async function createOrOpenDm(userId: string): Promise<DirectMessageItem> {
  try {
    const { data } = await http.post<DirectMessageItem>('/api/dms', { user_id: userId })
    return data
  } catch (e) { handleError(e) }
}

export async function inviteToConversation(conversationId: string, userId: string): Promise<void> {
  try {
    await http.post('/api/conversations/invite', { conversation_id: conversationId, user_id: userId })
  } catch (e) { handleError(e) }
}

export async function listConversationMembers(conversationId: string): Promise<ConversationMemberItem[]> {
  try {
    const { data } = await http.get<ConversationMemberItem[]>('/api/conversations/members', {
      params: { conversation_id: conversationId },
    })
    return data
  } catch (e) { handleError(e) }
}

export async function listConversationMessages(
  conversationId: string,
  beforeChannelSeq?: bigint,
): Promise<ConversationHistoryPage> {
  const startedAt = performance.now()
  console.debug('[perf][conversation-open] api:listConversationMessages:start', {
    conversationId,
    beforeChannelSeq: typeof beforeChannelSeq === 'bigint' ? beforeChannelSeq.toString() : undefined,
  })
  try {
    const { data } = await http.get<ConversationHistoryPage>('/api/messages', {
      params: {
        conversation_id: conversationId,
        ...(typeof beforeChannelSeq === 'bigint'
          ? { before_channel_seq: beforeChannelSeq.toString() }
          : {}),
      },
    })
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100
    console.debug('[perf][conversation-open] api:listConversationMessages:done', {
      conversationId,
      count: data.messages.length,
      hasMore: data.has_more,
      elapsedMs,
    })
    return data
  } catch (e) {
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100
    console.debug('[perf][conversation-open] api:listConversationMessages:error', {
      conversationId,
      elapsedMs,
    })
    handleError(e)
  }
}

export async function listMessageReactionUsers(
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<ReactionUserItem[]> {
  try {
    const { data } = await http.get<ReactionUsersResponse>('/api/messages/reaction-users', {
      params: {
        conversation_id: conversationId,
        message_id: messageId,
        emoji,
      },
    })
    return data.users ?? []
  } catch (e) { handleError(e) }
}

export async function uploadChatAttachment(
  conversationId: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ChatMessageAttachmentItem> {
  const form = new FormData()
  form.append('conversation_id', conversationId)
  form.append('file', file)
  try {
    const { data } = await http.post<ChatMessageAttachmentItem>('/api/chat/attachments', form, {
      onUploadProgress: (event: AxiosProgressEvent) => {
        onProgress?.(
          event.loaded ?? 0,
          event.total ?? file.size,
        )
      },
    })
    return data
  } catch (e) { handleError(e) }
}

export async function deleteChatAttachment(attachmentId: string): Promise<void> {
  try {
    await http.delete(`/api/chat/attachments/${attachmentId}`)
  } catch (e) { handleError(e) }
}

export async function fetchMessageAttachmentBlob(messageId: string, attachmentId: string): Promise<Blob> {
  try {
    const { data } = await http.get(
      `/api/messages/${messageId}/attachments/${attachmentId}/download`,
      { responseType: 'blob' },
    )
    return data as Blob
  } catch (e) { handleError(e) }
}
