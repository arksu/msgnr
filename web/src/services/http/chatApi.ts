import { AxiosError } from 'axios'
import type { AxiosProgressEvent } from 'axios'
import { createAuthenticatedClient } from './client'
import type { UserCustomStatusDto } from '@/types/userStatus'

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

export async function clearDMConversationHistory(conversationId: string): Promise<void> {
  try {
    await http.post('/api/conversations/clear-history', { conversation_id: conversationId })
  } catch (e) { handleError(e) }
}

export interface DmCandidateItem {
  user_id: string
  display_name: string
  email: string
  avatar_url: string
  custom_status?: UserCustomStatusDto | null
}

export interface ConversationMemberItem {
  user_id: string
  display_name: string
  email: string
  avatar_url: string
  custom_status?: UserCustomStatusDto | null
}

export interface DirectMessageItem {
  conversation_id: string
  user_id: string
  display_name: string
  email: string
  avatar_url: string
  custom_status?: UserCustomStatusDto | null
  kind: string
  visibility: string
}

export interface ConversationMessageItem {
  id: string
  conversation_id: string
  sender_id: string
  sender_name: string
  body: string
  forwarded_from?: ForwardedMessageItem
  entities: MessageEntityItem[]
  channel_seq: string | number
  thread_seq: string | number
  thread_root_message_id: string
  thread_reply_count?: number
  edited_at?: string
  mention_everyone: boolean
  created_at: string
  reactions?: Array<{ emoji: string; count: number }>
  my_reactions?: string[]
  attachments?: ChatMessageAttachmentItem[]
  is_saved?: boolean
}

export interface ForwardedMessageItem {
  message_id: string
  sender_id: string
  sender_name: string
  conversation_kind?: string
  conversation_title?: string
  thread_title?: string
}

export interface ChatMessageAttachmentItem {
  id: string
  file_name: string
  file_size: number
  mime_type: string
}

export type MessageEntityKind = 'user' | 'task' | 'document'

export interface MessageEntityItem {
  kind: MessageEntityKind
  target_id: string
  label: string
  href: string
  start: number
  end: number
}

export interface ConversationHistoryPage {
  messages: ConversationMessageItem[]
  has_more: boolean
  page_size: number
  next_before_channel_seq?: string
}

export interface UnreadFeedItem {
  id: string
  kind: 'message' | 'mention' | 'thread'
  notification_id?: string
  conversation_id: string
  conversation_kind: 'channel' | 'dm'
  conversation_visibility: 'public' | 'private' | 'dm'
  conversation_title: string
  message_id?: string
  thread_root_message_id?: string
  sender_id?: string
  sender_name: string
  body: string
  created_at: string
}

export interface UnreadFeedResponse {
  total_count: number
  items: UnreadFeedItem[]
}

export interface SavedMessageItem {
  id: string
  conversation_id: string
  conversation_kind: 'channel' | 'dm'
  conversation_visibility: 'public' | 'private' | 'dm'
  conversation_title: string
  message_id: string
  thread_root_message_id?: string
  sender_id: string
  sender_name: string
  body: string
  forwarded_from?: ForwardedMessageItem
  entities?: MessageEntityItem[]
  created_at: string
  saved_at: string
}

export interface ForwardTargetConversationItem {
  conversation_id: string
  title: string
  kind: 'channel' | 'dm'
  visibility: 'public' | 'private' | 'dm'
}

export interface ForwardTargetThreadItem {
  conversation_id: string
  conversation_title: string
  thread_root_message_id: string
  root_sender_name: string
  root_body: string
  reply_count: number
  last_reply_at: string
}

export interface ForwardTargetsResponse {
  conversations: ForwardTargetConversationItem[]
  threads: ForwardTargetThreadItem[]
}

export interface SavedMessagesResponse {
  total_count: number
  items: SavedMessageItem[]
}

export interface ReactionUserItem {
  user_id: string
  display_name: string
  avatar_url: string
}

interface ReactionUsersResponse {
  users: ReactionUserItem[]
}

interface EditMessageResponse {
  message_id: string
  edited_at: string
  entities: MessageEntityItem[]
}

export interface TagSearchUserItem {
  user_id: string
  display_name: string
  email: string
  avatar_url: string
  custom_status?: UserCustomStatusDto | null
  presence: 'online' | 'away' | 'offline'
}

export interface TagSearchTaskItem {
  task_id: string
  public_id: string
  title: string
  label: string
  href: string
}

export interface TagSearchDocumentItem {
  document_id: string
  title: string
  label: string
  href: string
}

export interface TagSearchResponse {
  users: TagSearchUserItem[]
  tasks: TagSearchTaskItem[]
  documents: TagSearchDocumentItem[]
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

export async function removeConversationMember(conversationId: string, userId: string): Promise<void> {
  try {
    await http.post('/api/conversations/members/remove', { conversation_id: conversationId, user_id: userId })
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

export async function listActiveCallMembers(conversationId: string): Promise<ConversationMemberItem[]> {
  try {
    const { data } = await http.get<ConversationMemberItem[]>('/api/conversations/active-call-members', {
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

export async function getMessageContext(
  conversationId: string,
  messageId: string,
): Promise<ConversationHistoryPage> {
  try {
    const { data } = await http.get<ConversationHistoryPage>('/api/messages/context', {
      params: {
        conversation_id: conversationId,
        message_id: messageId,
      },
    })
    return data
  } catch (e) { handleError(e) }
}

export async function listUnreadFeed(): Promise<UnreadFeedResponse> {
  try {
    const { data } = await http.get<UnreadFeedResponse>('/api/chat/unread-feed')
    return data
  } catch (e) { handleError(e) }
}

export async function listSavedMessages(): Promise<SavedMessagesResponse> {
  try {
    const { data } = await http.get<SavedMessagesResponse>('/api/chat/saved-messages')
    return data
  } catch (e) { handleError(e) }
}

export async function listForwardTargets(): Promise<ForwardTargetsResponse> {
  try {
    const { data } = await http.get<ForwardTargetsResponse>('/api/chat/forward-targets')
    return {
      conversations: data.conversations ?? [],
      threads: data.threads ?? [],
    }
  } catch (e) { handleError(e) }
}

export async function saveMessage(messageId: string): Promise<void> {
  try {
    await http.post(`/api/messages/${messageId}/save`)
  } catch (e) { handleError(e) }
}

export async function unsaveMessage(messageId: string): Promise<void> {
  try {
    await http.delete(`/api/messages/${messageId}/save`)
  } catch (e) { handleError(e) }
}

export async function forwardMessage(
  messageId: string,
  destinationConversationId: string,
  destinationThreadRootMessageId = '',
): Promise<void> {
  try {
    await http.post(`/api/messages/${messageId}/forward`, {
      destination_conversation_id: destinationConversationId,
      destination_thread_root_message_id: destinationThreadRootMessageId,
    })
  } catch (e) { handleError(e) }
}

export async function resolveUnreadFeedNotification(notificationId: string): Promise<void> {
  try {
    await http.post('/api/chat/unread-feed/resolve', {
      notification_id: notificationId,
    })
  } catch (e) { handleError(e) }
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

export async function searchTagEntities(conversationId: string, q = ''): Promise<TagSearchResponse> {
  try {
    const { data } = await http.get<TagSearchResponse>('/api/chat/tag-search', {
      params: {
        conversation_id: conversationId,
        q,
      },
    })
    return {
      users: data.users ?? [],
      tasks: data.tasks ?? [],
      documents: data.documents ?? [],
    }
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

export async function editMessage(messageId: string, body: string, entities: MessageEntityItem[] = []): Promise<EditMessageResponse> {
  try {
    const { data } = await http.patch<EditMessageResponse>(`/api/messages/${messageId}`, { body, entities })
    return data
  } catch (e) { handleError(e) }
}

export async function deleteMessage(messageId: string): Promise<void> {
  try {
    await http.delete(`/api/messages/${messageId}`)
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
