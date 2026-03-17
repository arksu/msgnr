import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { TaskDescriptionCollabMessageKind } from '@/shared/proto/packets_pb'
import { useWsStore, type WsState } from '@/stores/ws'

type CollabPayload = {
  kind: TaskDescriptionCollabMessageKind
  payload: Uint8Array
}

const SYNC_MAGIC_0 = 0x54 // 'T'
const SYNC_MAGIC_1 = 0x44 // 'D'
const SYNC_PROTOCOL_V1 = 1
const PERSISTED_SEED_DELAY_MS = 250

const SyncFrameType = {
  UPDATE: 1,
  STATE_VECTOR: 2,
  STATE_UPDATE: 3,
} as const

type SyncFrameTypeValue = typeof SyncFrameType[keyof typeof SyncFrameType]

type SyncFrame = {
  type: SyncFrameTypeValue
  payload: Uint8Array
  legacy: boolean
}

export interface TaskDescriptionCollabUser {
  id: string
  name: string
  color: string
}

const READY_STATES: WsState[] = [
  'AUTH_COMPLETE',
  'BOOTSTRAPPING',
  'LIVE_SYNCED',
  'RECOVERING_GAP',
  'STALE_REBOOTSTRAP',
]
const DEBUG_TASK_COLLAB = true

function isWsReady(state: WsState): boolean {
  return READY_STATES.includes(state)
}

function markdownSignature(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  const preview = input.slice(0, 80).replace(/\n/g, '\\n')
  return `len=${input.length},hash=${hash},preview="${preview}"`
}

function collabLog(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_TASK_COLLAB) return
  console.debug('[task-desc-collab]', event, payload)
}

function docMarkdownSignature(doc: Y.Doc | null): string {
  if (!doc) return 'doc=null'
  // IMPORTANT: collaboration field uses XmlFragment via tiptap-collaboration.
  // Using getText() on the same field name would create a conflicting Y type.
  const stateVector = Y.encodeStateVector(doc)
  let hash = 0
  for (let i = 0; i < stateVector.length; i += 1) {
    hash = ((hash << 5) - hash) + stateVector[i]
    hash |= 0
  }
  return `stateVectorBytes=${stateVector.length},stateVectorHash=${hash}`
}

function encodeSyncFrame(type: SyncFrameTypeValue, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length)
  out[0] = SYNC_MAGIC_0
  out[1] = SYNC_MAGIC_1
  out[2] = SYNC_PROTOCOL_V1
  out[3] = type
  out.set(payload, 4)
  return out
}

function decodeSyncFrame(input: Uint8Array): SyncFrame {
  if (input.length >= 4 &&
    input[0] === SYNC_MAGIC_0 &&
    input[1] === SYNC_MAGIC_1 &&
    input[2] === SYNC_PROTOCOL_V1
  ) {
    const type = input[3]
    if (type === SyncFrameType.UPDATE || type === SyncFrameType.STATE_VECTOR || type === SyncFrameType.STATE_UPDATE) {
      return {
        type,
        payload: input.subarray(4),
        legacy: false,
      }
    }
  }
  // Backward compatibility with older clients that sent raw Y updates.
  return {
    type: SyncFrameType.UPDATE,
    payload: input,
    legacy: true,
  }
}

export function useTaskDescriptionCollab(params: {
  taskId: Ref<string | null>
  user: Ref<TaskDescriptionCollabUser | null>
}) {
  const wsStore = useWsStore()

  const doc = shallowRef<Y.Doc | null>(null)
  const provider = shallowRef<{ awareness: Awareness } | null>(null)
  const subscribeError = ref<string | null>(null)
  const subscribedTaskId = ref<string | null>(null)
  const serverMarkdown = ref<string | null>(null)

  const pending: CollabPayload[] = []
  let awarenessListener: ((payload: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void) | null = null
  let docListener: ((update: Uint8Array, origin: unknown) => void) | null = null
  let hasLocalEdits = false
  let receivedMeaningfulRemoteSync = false
  let hasRemotePeers = false
  let subscribeAttempt = 0
  let subscribeResponseCount = 0
  let pendingPersistedMarkdown: string | null = null
  let seedFallbackTimer: ReturnType<typeof setTimeout> | null = null

  function awarenessPeerSnapshot(awareness: Awareness | null | undefined): { local: number; clients: number[]; hasRemote: boolean } {
    if (!awareness) return { local: -1, clients: [], hasRemote: false }
    const local = awareness.clientID
    const clients = Array.from(awareness.getStates().keys())
    const hasRemote = clients.some(clientID => clientID !== local)
    return { local, clients, hasRemote }
  }

  function shouldSeedAsLeader(): boolean {
    if (!provider.value?.awareness) return true
    const snapshot = awarenessPeerSnapshot(provider.value.awareness)
    if (snapshot.clients.length === 0) return true
    const minClientID = snapshot.clients.reduce((min, current) => Math.min(min, current), snapshot.clients[0])
    return snapshot.local === minClientID
  }

  function refreshRemotePeerPresence(reason: string, taskId: string) {
    const snapshot = awarenessPeerSnapshot(provider.value?.awareness)
    hasRemotePeers = snapshot.hasRemote
    collabLog('awareness:peers', {
      taskId,
      reason,
      local: snapshot.local,
      clients: snapshot.clients,
      hasRemotePeers,
      isSeedLeader: shouldSeedAsLeader(),
    })
  }

  function clearSeedFallbackTimer() {
    if (!seedFallbackTimer) return
    clearTimeout(seedFallbackTimer)
    seedFallbackTimer = null
  }

  function sendSyncFrame(taskId: string, type: SyncFrameTypeValue, payload: Uint8Array, reason: string) {
    const framed = encodeSyncFrame(type, payload)
    collabLog('sync:send', {
      taskId,
      reason,
      type,
      frameBytes: framed.length,
      payloadBytes: payload.length,
      wsState: wsStore.state,
    })
    sendOrQueue(taskId, {
      kind: TaskDescriptionCollabMessageKind.SYNC,
      payload: framed,
    })
  }

  function requestPeerState(taskId: string, reason: string) {
    if (!doc.value) return
    const stateVector = Y.encodeStateVector(doc.value)
    sendSyncFrame(taskId, SyncFrameType.STATE_VECTOR, stateVector, reason)
  }

  function schedulePersistedSeed(taskId: string) {
    clearSeedFallbackTimer()
    if (pendingPersistedMarkdown === null) return
    seedFallbackTimer = setTimeout(() => {
      seedFallbackTimer = null
      if (taskId !== params.taskId.value) return
      const persisted = pendingPersistedMarkdown ?? ''
      if (receivedMeaningfulRemoteSync || hasLocalEdits) {
        collabLog('seed:persisted:skip', {
          taskId,
          reason: receivedMeaningfulRemoteSync ? 'received-meaningful-remote-sync' : 'has-local-edits',
          persisted: markdownSignature(persisted),
        })
        pendingPersistedMarkdown = null
        return
      }
      if (hasRemotePeers && !shouldSeedAsLeader()) {
        collabLog('seed:persisted:defer-non-leader', {
          taskId,
          persisted: markdownSignature(persisted),
        })
        schedulePersistedSeed(taskId)
        return
      }
      collabLog('seed:persisted:apply', {
        taskId,
        persisted: markdownSignature(persisted),
      })
      serverMarkdown.value = persisted
      pendingPersistedMarkdown = null
    }, PERSISTED_SEED_DELAY_MS)
  }

  function flushPending(taskId: string) {
    if (!isWsReady(wsStore.state)) return
    collabLog('flushPending:start', { taskId, queue: pending.length, wsState: wsStore.state })
    while (pending.length > 0) {
      const next = pending[0]
      const ok = wsStore.sendTaskDescriptionCollabMessage(taskId, next.kind, next.payload)
      if (!ok) return
      pending.shift()
    }
    collabLog('flushPending:done', { taskId, queue: pending.length })
  }

  function sendOrQueue(taskId: string, msg: CollabPayload) {
    if (!isWsReady(wsStore.state)) {
      collabLog('sendOrQueue:queue:ws-not-ready', { taskId, kind: msg.kind, bytes: msg.payload.length, wsState: wsStore.state })
      pending.push(msg)
      return
    }
    const ok = wsStore.sendTaskDescriptionCollabMessage(taskId, msg.kind, msg.payload)
    if (!ok) {
      collabLog('sendOrQueue:queue:send-failed', { taskId, kind: msg.kind, bytes: msg.payload.length, wsState: wsStore.state })
      pending.push(msg)
      return
    }
    collabLog('sendOrQueue:sent', { taskId, kind: msg.kind, bytes: msg.payload.length, wsState: wsStore.state })
  }

  function cleanupDoc() {
    collabLog('cleanupDoc:start', {
      taskId: params.taskId.value,
      subscribedTaskId: subscribedTaskId.value,
      queue: pending.length,
    })
    if (doc.value && docListener) {
      doc.value.off('update', docListener)
    }
    if (provider.value && awarenessListener) {
      provider.value.awareness.off('update', awarenessListener)
    }
    if (provider.value?.awareness && provider.value.awareness.clientID >= 0) {
      removeAwarenessStates(provider.value.awareness, [provider.value.awareness.clientID], 'local-destroy')
    }
    provider.value?.awareness.destroy()
    doc.value?.destroy()
    doc.value = null
    provider.value = null
    awarenessListener = null
    docListener = null
    hasLocalEdits = false
    receivedMeaningfulRemoteSync = false
    hasRemotePeers = false
    subscribeAttempt = 0
    subscribeResponseCount = 0
    pendingPersistedMarkdown = null
    clearSeedFallbackTimer()
    serverMarkdown.value = null
    pending.length = 0
    collabLog('cleanupDoc:done', { taskId: params.taskId.value })
  }

  function subscribe(taskId: string) {
    if (!isWsReady(wsStore.state)) return
    subscribeAttempt += 1
    collabLog('subscribe', {
      taskId,
      wsState: wsStore.state,
      subscribeAttempt,
      doc: docMarkdownSignature(doc.value),
    })
    wsStore.sendTaskDescriptionCollabSubscribe(taskId)
    subscribedTaskId.value = taskId
    flushPending(taskId)
  }

  function unsubscribe(taskId: string) {
    if (!taskId) return
    collabLog('unsubscribe', { taskId, wsState: wsStore.state })
    if (isWsReady(wsStore.state)) {
      wsStore.sendTaskDescriptionCollabUnsubscribe(taskId)
    }
    subscribedTaskId.value = null
  }

  function setupDoc(taskId: string) {
    collabLog('setupDoc:start', { taskId, wsState: wsStore.state })
    cleanupDoc()

    const nextDoc = new Y.Doc()
    const awareness = new Awareness(nextDoc)
    doc.value = nextDoc
    provider.value = { awareness }
    subscribeError.value = null

    docListener = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') {
        hasLocalEdits = true
      }
      collabLog('doc:update', {
        taskId,
        origin: String(origin),
        bytes: update.length,
        hasLocalEdits,
        doc: docMarkdownSignature(nextDoc),
      })
      if (origin === 'remote') return
      sendSyncFrame(taskId, SyncFrameType.UPDATE, update, 'doc-update')
    }
    nextDoc.on('update', docListener)

    awarenessListener = ({ added, updated, removed }, origin) => {
      if (origin === 'remote') return
      const changed = [...added, ...updated, ...removed]
      if (changed.length === 0) return
      const payload = encodeAwarenessUpdate(awareness, changed)
      collabLog('awareness:update', {
        taskId,
        origin: String(origin),
        added,
        updated,
        removed,
        changed,
        bytes: payload.length,
      })
      refreshRemotePeerPresence('local-awareness-update', taskId)
      sendOrQueue(taskId, {
        kind: TaskDescriptionCollabMessageKind.AWARENESS,
        payload,
      })
    }
    awareness.on('update', awarenessListener)

    const user = params.user.value
    if (user) {
      // Register listener first, then set the initial user state so peers
      // receive the first awareness broadcast for leader election.
      awareness.setLocalStateField('user', {
        id: user.id,
        name: user.name,
        color: user.color,
      })
    }
    refreshRemotePeerPresence('setup-doc', taskId)

    subscribe(taskId)
    collabLog('setupDoc:done', { taskId })
  }

  wsStore.onTaskDescriptionCollabSubscribeResponse((resp) => {
    const taskId = params.taskId.value
    if (!taskId || resp.taskId !== taskId) return
    subscribeResponseCount += 1
    collabLog('onSubscribeResponse', {
      taskId,
      subscribeAttempt,
      subscribeResponseCount,
      hasLocalEdits,
      persisted: markdownSignature(resp.persistedMarkdown),
      doc: docMarkdownSignature(doc.value),
    })
    subscribeError.value = null
    pendingPersistedMarkdown = resp.persistedMarkdown
    receivedMeaningfulRemoteSync = false
    requestPeerState(taskId, 'subscribe-response')
    schedulePersistedSeed(taskId)
    flushPending(taskId)
  })

  wsStore.onTaskDescriptionCollabMessage((msg) => {
    const taskId = params.taskId.value
    if (!taskId || msg.taskId !== taskId || !doc.value || !provider.value) return
    const before = docMarkdownSignature(doc.value)
    collabLog('onCollabMessage', {
      taskId,
      kind: msg.kind,
      bytes: msg.payload.length,
      before,
    })
    if (msg.kind === TaskDescriptionCollabMessageKind.SYNC) {
      const frame = decodeSyncFrame(msg.payload)
      collabLog('onCollabMessage:sync-frame', {
        taskId,
        type: frame.type,
        legacy: frame.legacy,
        payloadBytes: frame.payload.length,
      })
      if (frame.type === SyncFrameType.STATE_VECTOR) {
        const stateUpdate = Y.encodeStateAsUpdate(doc.value, frame.payload)
        sendSyncFrame(taskId, SyncFrameType.STATE_UPDATE, stateUpdate, 'state-vector-request')
        return
      }
      if (frame.type === SyncFrameType.UPDATE || frame.type === SyncFrameType.STATE_UPDATE) {
        Y.applyUpdate(doc.value, frame.payload, 'remote')
        const after = docMarkdownSignature(doc.value)
        const changed = after !== before
        if (changed) {
          receivedMeaningfulRemoteSync = true
          clearSeedFallbackTimer()
        }
        collabLog('onCollabMessage:sync-applied', {
          taskId,
          type: frame.type,
          legacy: frame.legacy,
          bytes: frame.payload.length,
          changed,
          before,
          after,
        })
      }
      return
    }
    if (msg.kind === TaskDescriptionCollabMessageKind.AWARENESS) {
      applyAwarenessUpdate(provider.value.awareness, msg.payload, 'remote')
      refreshRemotePeerPresence('remote-awareness-update', taskId)
      collabLog('onCollabMessage:awareness-applied', {
        taskId,
        bytes: msg.payload.length,
      })
    }
  })

  watch(
    () => params.taskId.value,
    (next, prev) => {
      collabLog('watch:taskId', { prev, next, wsState: wsStore.state })
      if (prev) {
        unsubscribe(prev)
      }
      if (!next) {
        cleanupDoc()
        return
      }
      setupDoc(next)
    },
    { immediate: true },
  )

  watch(
    () => params.user.value,
    (user) => {
      collabLog('watch:user', { taskId: params.taskId.value, hasUser: !!user })
      if (!provider.value?.awareness) return
      if (!user) {
        provider.value.awareness.setLocalStateField('user', null)
        return
      }
      provider.value.awareness.setLocalStateField('user', {
        id: user.id,
        name: user.name,
        color: user.color,
      })
    },
    { deep: true },
  )

  watch(
    () => wsStore.state,
    (next, prev) => {
      const taskId = params.taskId.value
      if (!taskId) return
      collabLog('watch:wsState', { taskId, prev, next, doc: docMarkdownSignature(doc.value) })
      if (!isWsReady(next)) return
      subscribe(taskId)
    },
  )

  onBeforeUnmount(() => {
    if (params.taskId.value) {
      unsubscribe(params.taskId.value)
    }
    cleanupDoc()
  })

  return {
    doc,
    provider,
    subscribeError,
    serverMarkdown,
  }
}
