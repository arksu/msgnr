import type { Ref } from 'vue'
import {
  type TaskDescriptionCollabMessage,
  type TaskDescriptionCollabSubscribeResponse,
} from '@/shared/proto/packets_pb'
import { useRichTextCollab, type RichTextCollabUser } from '@/composables/useRichTextCollab'

export type TaskDescriptionCollabUser = RichTextCollabUser

export function useTaskDescriptionCollab(params: {
  taskId: Ref<string | null>
  user: Ref<TaskDescriptionCollabUser | null>
}) {
  return useRichTextCollab<TaskDescriptionCollabSubscribeResponse, TaskDescriptionCollabMessage>({
    entityId: params.taskId,
    user: params.user,
    logLabel: 'task-desc-collab',
    transportFactory: (wsStore) => ({
      sendSubscribe: (taskId) => wsStore.sendTaskDescriptionCollabSubscribe(taskId),
      sendUnsubscribe: (taskId) => wsStore.sendTaskDescriptionCollabUnsubscribe(taskId),
      sendMessage: (taskId, kind, payload) => wsStore.sendTaskDescriptionCollabMessage(taskId, kind, payload),
      onSubscribeResponse: (cb) => wsStore.onTaskDescriptionCollabSubscribeResponse(cb),
      onMessage: (cb) => wsStore.onTaskDescriptionCollabMessage(cb),
      getSubscribeResponseEntityId: (resp) => resp.taskId,
      getSubscribeResponsePersistedMarkdown: (resp) => resp.persistedMarkdown,
      getSubscribeResponseSubscriberCount: (resp) => resp.subscriberCount,
      getSubscribeResponseRoomSnapshot: (resp) => resp.roomSnapshot,
      getMessageEntityId: (msg) => msg.taskId,
      getMessageKind: (msg) => msg.kind,
      getMessagePayload: (msg) => msg.payload,
    }),
  })
}
