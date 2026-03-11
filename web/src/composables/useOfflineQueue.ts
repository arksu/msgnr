import { ref } from 'vue'
import type { useWsStore } from '@/stores/ws'
import {
  enqueueOutbound,
  loadOutboundQueue,
  removeOutbound,
  clearOutboundQueue,
} from '@/services/db/cache'

export interface PendingOutboundMessage {
  conversationId: string
  body: string
  clientMsgId: string
  threadRootMessageId?: string
  attachmentIds?: string[]
}

// Singleton queue shared across all composable calls
const queue = ref<PendingOutboundMessage[]>([])
let hydrated = false

export function useOfflineQueue() {
  function enqueue(msg: PendingOutboundMessage) {
    // Avoid duplicates (e.g. if component re-mounts and re-submits)
    if (queue.value.some((m) => m.clientMsgId === msg.clientMsgId)) return
    queue.value = [...queue.value, msg]
    // Persist to IndexedDB (fire-and-forget)
    void enqueueOutbound({
      conversationId: msg.conversationId,
      body: msg.body,
      clientMsgId: msg.clientMsgId,
      threadRootMessageId: msg.threadRootMessageId,
      attachmentIds: msg.attachmentIds,
    })
  }

  /**
   * Flush all queued messages over the (now-live) WS connection.
   * Called after successful reconnect + AUTH_COMPLETE.
   */
  function flush(ws: ReturnType<typeof useWsStore>) {
    const pending = queue.value
    queue.value = []
    // Clear IndexedDB queue (fire-and-forget)
    void clearOutboundQueue()
    for (const msg of pending) {
      ws.sendMessage(msg.conversationId, msg.body, msg.clientMsgId, msg.threadRootMessageId, msg.attachmentIds ?? [])
    }
  }

  /** Remove a specific message from the queue (e.g. if user deletes the optimistic bubble) */
  function remove(clientMsgId: string) {
    queue.value = queue.value.filter((m) => m.clientMsgId !== clientMsgId)
    // Remove from IndexedDB (fire-and-forget)
    void removeOutbound(clientMsgId)
  }

  /** Clear everything — called on logout */
  function clear() {
    queue.value = []
    void clearOutboundQueue()
  }

  /**
   * Load persisted queue from IndexedDB on startup.
   * Should be called once during app initialization.
   * Returns the loaded messages so they can be rendered with queued status.
   */
  async function loadPersisted(): Promise<PendingOutboundMessage[]> {
    if (hydrated) return queue.value
    hydrated = true
    try {
      const stored = await loadOutboundQueue()
      if (stored.length === 0) return []
      const loaded: PendingOutboundMessage[] = stored.map(item => ({
        conversationId: item.conversationId,
        body: item.body,
        clientMsgId: item.clientMsgId,
        threadRootMessageId: item.threadRootMessageId,
        attachmentIds: item.attachmentIds,
      }))
      // Merge with any already-in-memory items (avoid duplicates)
      for (const msg of loaded) {
        if (!queue.value.some(m => m.clientMsgId === msg.clientMsgId)) {
          queue.value = [...queue.value, msg]
        }
      }
      return loaded
    } catch {
      return []
    }
  }

  return { queue, enqueue, flush, remove, clear, loadPersisted }
}
