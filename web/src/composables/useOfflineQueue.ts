import { ref } from 'vue'
import type { useWsStore } from '@/stores/ws'

export interface PendingOutboundMessage {
  conversationId: string
  body: string
  clientMsgId: string
  threadRootMessageId?: string
}

// Singleton queue shared across all composable calls
const queue = ref<PendingOutboundMessage[]>([])

export function useOfflineQueue() {
  function enqueue(msg: PendingOutboundMessage) {
    // Avoid duplicates (e.g. if component re-mounts and re-submits)
    if (queue.value.some((m) => m.clientMsgId === msg.clientMsgId)) return
    queue.value = [...queue.value, msg]
  }

  /**
   * Flush all queued messages over the (now-live) WS connection.
   * Called after successful reconnect + AUTH_COMPLETE.
   */
  function flush(ws: ReturnType<typeof useWsStore>) {
    const pending = queue.value
    queue.value = []
    for (const msg of pending) {
      ws.sendMessage(msg.conversationId, msg.body, msg.clientMsgId, msg.threadRootMessageId)
    }
  }

  /** Remove a specific message from the queue (e.g. if user deletes the optimistic bubble) */
  function remove(clientMsgId: string) {
    queue.value = queue.value.filter((m) => m.clientMsgId !== clientMsgId)
  }

  /** Clear everything — called on logout */
  function clear() {
    queue.value = []
  }

  return { queue, enqueue, flush, remove, clear }
}
