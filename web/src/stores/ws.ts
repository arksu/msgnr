import { defineStore } from 'pinia'
import { ref } from 'vue'
import { create, toBinary, fromBinary } from '@bufbuild/protobuf'
import {
  EnvelopeSchema,
  type Envelope,
  type SendMessageAck,
  type ReactionAck,
  type SubscribeThreadResponse,
  type ServerEvent,
  type BootstrapResponse,
  type SyncSinceResponse,
  type AckResponse,
  type ReadCursorAck,
  type PresenceEvent,
  type TypingEvent,
  type CreateCallResponse,
  type InviteCallMembersResponse,
  type JoinCallTokenResponse,
  type CallInviteActionAck,
  type SetNotificationLevelResponse,
  FeatureCapability,
  ErrorCode,
  ConversationType,
  WorkspaceRole,
  NotificationLevel,
} from '@/shared/proto/packets_pb'
import { generateId } from '@/services/id'

export type ServerEventHandler = (evt: ServerEvent) => void
export type SendMessageAckHandler = (ack: SendMessageAck) => void
export type ReactionAckHandler = (ack: ReactionAck) => void
export type SubscribeThreadResponseHandler = (resp: SubscribeThreadResponse) => void
export type BootstrapResponseHandler = (resp: BootstrapResponse) => void
export type SyncSinceResponseHandler = (resp: SyncSinceResponse) => void
export type AckResponseHandler = (resp: AckResponse) => void
export type ReadCursorAckHandler = (ack: ReadCursorAck) => void
export type PresenceEventHandler = (evt: PresenceEvent) => void
export type TypingEventHandler = (evt: TypingEvent) => void
export type CreateCallResponseHandler = (resp: CreateCallResponse) => void
export type InviteCallMembersResponseHandler = (resp: InviteCallMembersResponse, requestId: string) => void
export type JoinCallTokenResponseHandler = (resp: JoinCallTokenResponse) => void
export type CallInviteActionAckHandler = (ack: CallInviteActionAck) => void
export type SetNotificationLevelResponseHandler = (resp: SetNotificationLevelResponse) => void
export type ProtocolErrorHandler = (err: { requestId: string; code: ErrorCode; message: string; retryAfterMs: number }) => void

export type WsState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'WS_CONNECTED'
  | 'HELLO_SENT'
  | 'HELLO_COMPLETE'
  | 'AUTH_SENT'
  | 'AUTH_COMPLETE'
  | 'BOOTSTRAPPING'
  | 'LIVE_SYNCED'
  | 'RECOVERING_GAP'
  | 'STALE_REBOOTSTRAP'

export type WsErrorKind = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'BAD_REQUEST' | 'PROTOCOL' | 'TRANSPORT'

export interface WsAuthResult {
  userId: string
  sessionId: string
  persistedEventSeq: bigint
  userRole: string
}

const PROTOCOL_VERSION = 1
const WS_OPEN = 1   // WebSocket.OPEN
const WS_CLOSED = 3 // WebSocket.CLOSED

const REQUESTED_CAPABILITIES: FeatureCapability[] = Object.values(FeatureCapability)
  .filter((v): v is FeatureCapability => typeof v === 'number' && v !== FeatureCapability.UNSPECIFIED)

function packetLabel(envelope: Envelope): string {
  return envelope.payload.case ?? 'unknown'
}

function normalizeForLog(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(normalizeForLog)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeForLog(entry)])
    )
  }
  return value
}

function logPacket(direction: 'SEND' | 'RECV', envelope: Envelope) {
  const summary = `[WS ${direction}] ${packetLabel(envelope)}`
  const normalized = normalizeForLog(envelope)
  console.groupCollapsed(summary)
  console.log(normalized)
  console.groupEnd()
}

function workspaceRoleToSlug(role: WorkspaceRole): string {
  switch (role) {
    case WorkspaceRole.ADMIN:
      return 'admin'
    case WorkspaceRole.OWNER:
      return 'owner'
    case WorkspaceRole.MEMBER:
      return 'member'
    default:
      return ''
  }
}

export const useWsStore = defineStore('ws', () => {
  const state = ref<WsState>('DISCONNECTED')
  const serverHello = ref<Envelope['payload'] | null>(null)
  const authResult = ref<WsAuthResult | null>(null)
  const lastError = ref<string | null>(null)
  const lastErrorKind = ref<WsErrorKind | null>(null)
  const lastCloseCode = ref<number | null>(null)

  let onServerHelloCallback: (() => void) | null = null

  let socket: WebSocket | null = null
  let onAuthFailCallback: ((kind: WsErrorKind) => void) | null = null
  let onTransportDropCallback: (() => void) | null = null
  let suppressTransportDrop = false
  let pendingAuthToken: string | null = null
  let onServerEventCallback: ServerEventHandler | null = null
  let onSendMessageAckCallback: SendMessageAckHandler | null = null
  let onReactionAckCallback: ReactionAckHandler | null = null
  let onSubscribeThreadResponseCallback: SubscribeThreadResponseHandler | null = null
  let onBootstrapResponseCallback: BootstrapResponseHandler | null = null
  let onSyncSinceResponseCallback: SyncSinceResponseHandler | null = null
  let onAckResponseCallback: AckResponseHandler | null = null
  let onReadCursorAckCallback: ReadCursorAckHandler | null = null
  let onPresenceEventCallback: PresenceEventHandler | null = null
  let onTypingEventCallback: TypingEventHandler | null = null
  let onCreateCallResponseCallback: CreateCallResponseHandler | null = null
  let onInviteCallMembersResponseCallback: InviteCallMembersResponseHandler | null = null
  let onJoinCallTokenResponseCallback: JoinCallTokenResponseHandler | null = null
  let onCallInviteActionAckCallback: CallInviteActionAckHandler | null = null
  let onSetNotificationLevelResponseCallback: SetNotificationLevelResponseHandler | null = null
  let onProtocolErrorCallback: ProtocolErrorHandler | null = null

  function onAuthFail(cb: (kind: WsErrorKind) => void) {
    onAuthFailCallback = cb
  }

  function onTransportDrop(cb: () => void) {
    onTransportDropCallback = cb
  }

  function onServerHello(cb: () => void) {
    onServerHelloCallback = cb
  }

  function setPendingAuthToken(token: string) {
    pendingAuthToken = token
  }

  function clearPendingAuthToken() {
    pendingAuthToken = null
  }

  function onServerEvent(cb: ServerEventHandler) {
    onServerEventCallback = cb
  }

  function onSendMessageAck(cb: SendMessageAckHandler) {
    onSendMessageAckCallback = cb
  }

  function onReactionAck(cb: ReactionAckHandler) {
    onReactionAckCallback = cb
  }

  function onSubscribeThreadResponse(cb: SubscribeThreadResponseHandler) {
    onSubscribeThreadResponseCallback = cb
  }

  function onBootstrapResponse(cb: BootstrapResponseHandler) {
    onBootstrapResponseCallback = cb
  }

  function onSyncSinceResponse(cb: SyncSinceResponseHandler) {
    onSyncSinceResponseCallback = cb
  }

  function onAckResponse(cb: AckResponseHandler) {
    onAckResponseCallback = cb
  }

  function onReadCursorAck(cb: ReadCursorAckHandler) {
    onReadCursorAckCallback = cb
  }

  function onPresenceEvent(cb: PresenceEventHandler) {
    onPresenceEventCallback = cb
  }

  function onTypingEvent(cb: TypingEventHandler) {
    onTypingEventCallback = cb
  }

  function onCreateCallResponse(cb: CreateCallResponseHandler) {
    onCreateCallResponseCallback = cb
  }

  function onInviteCallMembersResponse(cb: InviteCallMembersResponseHandler) {
    onInviteCallMembersResponseCallback = cb
  }

  function onJoinCallTokenResponse(cb: JoinCallTokenResponseHandler) {
    onJoinCallTokenResponseCallback = cb
  }

  function onCallInviteActionAck(cb: CallInviteActionAckHandler) {
    onCallInviteActionAckCallback = cb
  }

  function onSetNotificationLevelResponse(cb: SetNotificationLevelResponseHandler) {
    onSetNotificationLevelResponseCallback = cb
  }

  function onProtocolError(cb: ProtocolErrorHandler) {
    onProtocolErrorCallback = cb
  }

  function connect(url: string) {
    if (socket && socket.readyState !== WS_CLOSED) {
      console.log('[ws:connect] closing old socket, suppressTransportDrop=true, readyState=', socket.readyState)
      suppressTransportDrop = true
      socket.close()
    }

    lastError.value = null
    lastErrorKind.value = null
    lastCloseCode.value = null
    serverHello.value = null
    authResult.value = null
    // Transition to CONNECTING so the orchestrator polling loop does not
    // mistake the pre-open window for a genuine disconnect.
    state.value = 'CONNECTING'

    const wsConn = new WebSocket(url)
    socket = wsConn
    suppressTransportDrop = false  // new socket is now the active one
    console.log('[ws:connect] new socket created, suppressTransportDrop reset to false')
    wsConn.binaryType = 'arraybuffer'

    // Track whether this socket ever progressed past DISCONNECTED (i.e. onopen fired).
    // onerror sets state = 'DISCONNECTED' before onclose fires, which would cause
    // the onclose wasConnected check to return false and silently suppress the
    // transport-drop callback. Using a per-socket flag avoids that race.
    let socketHadOpened = false

    wsConn.onopen = () => {
      if (socket !== wsConn) { console.log('[ws:onopen] stale socket, ignored'); return }
      console.log('[ws:onopen] socket opened')
      socketHadOpened = true
      state.value = 'WS_CONNECTED'
      sendHello()
    }

    wsConn.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socket !== wsConn) return
      handleMessage(event.data)
    }

    wsConn.onerror = () => {
      if (socket !== wsConn) { console.log('[ws:onerror] stale socket, ignored'); return }
      console.log('[ws:onerror] transport error, suppress=', suppressTransportDrop)
      lastError.value = 'WebSocket transport error'
      lastErrorKind.value = 'TRANSPORT'
      state.value = 'DISCONNECTED'
      // Do NOT fire onTransportDropCallback here — onerror is always followed
      // by onclose, which is the single authoritative place to fire it.
    }

    wsConn.onclose = (ev: CloseEvent) => {
      if (socket !== wsConn) { console.log('[ws:onclose] stale socket, ignored. code=', ev?.code); return }
      // Use socketHadOpened rather than state.value !== 'DISCONNECTED': onerror
      // sets state = 'DISCONNECTED' before onclose fires, which would wrongly
      // suppress the transport-drop callback for error-induced disconnects.
      const wasConnected = socketHadOpened
      lastCloseCode.value = ev?.code ?? null
      console.log('[ws:onclose] code=', ev?.code, 'wasConnected=', wasConnected, 'suppress=', suppressTransportDrop, 'lastErrorKind=', lastErrorKind.value)
      if (state.value !== 'DISCONNECTED') {
        state.value = 'DISCONNECTED'
      }
      if (
        !suppressTransportDrop &&
        wasConnected &&
        lastErrorKind.value !== 'UNAUTHENTICATED' &&
        lastErrorKind.value !== 'FORBIDDEN'
      ) {
        console.log('[ws:onclose] firing onTransportDropCallback')
        onTransportDropCallback?.()
      }
    }
  }

  function disconnect(reason: 'logout' | 'transport' = 'transport') {
    // Suppress transport-drop callback for intentional disconnects (logout)
    if (reason === 'logout') {
      onTransportDropCallback = null
    }
    socket?.close()
    socket = null
    state.value = 'DISCONNECTED'
  }

  function sendHello() {
    const envelope = create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'clientHello',
        value: {
          client: 'msgnr-web',
          clientVersion: '0.1.0',
          capabilities: REQUESTED_CAPABILITIES,
        },
      },
    })
    sendEnvelope(envelope)
    state.value = 'HELLO_SENT'
  }

  function sendAuth(accessToken: string): boolean {
    const envelope = create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'authRequest',
        value: { accessToken },
      },
    })
    const sent = sendEnvelope(envelope)
    if (sent) {
      state.value = 'AUTH_SENT'
    }
    return sent
  }

  function sendEnvelope(envelope: Envelope): boolean {
    if (!socket || socket.readyState !== WS_OPEN) {
      lastError.value = 'WebSocket is not open'
      lastErrorKind.value = 'TRANSPORT'
      return false
    }
    logPacket('SEND', envelope)
    const bytes = toBinary(EnvelopeSchema, envelope)
    socket.send(bytes)
    return true
  }

  function sendMessage(
    conversationId: string,
    body: string,
    clientMsgId: string,
    threadRootMessageId?: string,
    attachmentIds: string[] = [],
  ) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'sendMessageRequest',
        value: {
          conversationId,
          conversationType: ConversationType.CHANNEL_PUBLIC,
          clientMsgId,
          body,
          threadRootMessageId: threadRootMessageId ?? '',
          attachmentIds,
        },
      },
    }))
  }

  function sendAddReaction(conversationId: string, messageId: string, emoji: string, clientOpId: string) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'addReactionRequest',
        value: { conversationId, messageId, emoji, clientOpId },
      },
    }))
  }

  function sendRemoveReaction(conversationId: string, messageId: string, emoji: string, clientOpId: string) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'removeReactionRequest',
        value: { conversationId, messageId, emoji, clientOpId },
      },
    }))
  }

  function sendSubscribeThread(conversationId: string, threadRootMessageId: string, lastThreadSeq: bigint = 0n) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'subscribeThreadRequest',
        value: { conversationId, threadRootMessageId, lastThreadSeq },
      },
    }))
  }

  function sendBootstrap(args: {
    clientInstanceId: string
    includeArchived?: boolean
    pageSizeHint?: number
    pageToken?: string
    bootstrapSessionId?: string
  }) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'bootstrapRequest',
        value: {
          clientInstanceId: args.clientInstanceId,
          includeArchived: args.includeArchived ?? false,
          pageSizeHint: args.pageSizeHint ?? 0,
          pageToken: args.pageToken ?? '',
          bootstrapSessionId: args.bootstrapSessionId ?? '',
        },
      },
    }))
    state.value = 'BOOTSTRAPPING'
  }

  function sendSyncSince(afterSeq: bigint, maxEvents = 0) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'syncSinceRequest',
        value: {
          afterSeq,
          maxEvents,
        },
      },
    }))
    state.value = 'RECOVERING_GAP'
  }

  function sendAck(lastAppliedEventSeq: bigint) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'ackRequest',
        value: { lastAppliedEventSeq },
      },
    }))
  }

  function sendUpdateReadCursor(conversationId: string, lastReadSeq: bigint) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'updateReadCursorRequest',
        value: {
          conversationId,
          lastReadSeq,
        },
      },
    }))
  }

  function sendTyping(conversationId: string, isTyping: boolean, threadRootMessageId = '') {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'typingRequest',
        value: {
          conversationId,
          threadRootMessageId,
          isTyping,
        },
      },
    }))
  }

  function sendSetPresence(desiredPresence: number) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'setPresenceRequest',
        value: { desiredPresence },
      },
    }))
  }

  function sendSetNotificationLevel(conversationId: string, level: NotificationLevel): string {
    const requestId = generateId()
    sendEnvelope(create(EnvelopeSchema, {
      requestId,
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'setNotificationLevelRequest',
        value: {
          conversationId,
          level,
        },
      },
    }))
    return requestId
  }

  function sendCreateCall(conversationId: string, conversationType: ConversationType, inviteeUserIds: string[] = []) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'createCallRequest',
        value: {
          conversationId,
          conversationType,
          inviteeUserIds,
        },
      },
    }))
  }

  function sendJoinCallToken(conversationId: string, conversationType: ConversationType) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'joinCallTokenRequest',
        value: {
          conversationId,
          conversationType,
        },
      },
    }))
  }

  function sendInviteCallMembers(conversationId: string, conversationType: ConversationType, inviteeUserIds: string[] = []): string {
    const requestId = generateId()
    sendEnvelope(create(EnvelopeSchema, {
      requestId,
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'inviteCallMembersRequest',
        value: {
          conversationId,
          conversationType,
          inviteeUserIds,
        },
      },
    }))
    return requestId
  }

  function sendAcceptCallInvite(inviteId: string) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'acceptCallInviteRequest',
        value: { inviteId },
      },
    }))
  }

  function sendRejectCallInvite(inviteId: string) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'rejectCallInviteRequest',
        value: { inviteId },
      },
    }))
  }

  function sendCancelCallInvite(inviteId: string) {
    sendEnvelope(create(EnvelopeSchema, {
      requestId: generateId(),
      traceId: generateId(),
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        case: 'cancelCallInviteRequest',
        value: { inviteId },
      },
    }))
  }

  function setLiveSynced() {
    state.value = 'LIVE_SYNCED'
  }

  function setRecoveringGap() {
    state.value = 'RECOVERING_GAP'
  }

  function setStaleRebootstrap() {
    state.value = 'STALE_REBOOTSTRAP'
  }

  function handleMessage(data: ArrayBuffer) {
    let envelope: Envelope
    try {
      envelope = fromBinary(EnvelopeSchema, new Uint8Array(data))
    } catch {
      lastError.value = 'Failed to decode server envelope'
      lastErrorKind.value = 'PROTOCOL'
      return
    }
    logPacket('RECV', envelope)

    switch (envelope.payload.case) {
      case 'serverHello':
        serverHello.value = envelope.payload
        state.value = 'HELLO_COMPLETE'

        if (pendingAuthToken) {
          const token = pendingAuthToken
          const sent = sendAuth(token)
          if (sent) {
            pendingAuthToken = null
          }
        } else {
          console.warn('[ws-handshake] serverHello received without pending auth token')
        }

        onServerHelloCallback?.()
        onServerHelloCallback = null
        break

      case 'authResponse': {
        const ar = envelope.payload.value
        if (ar.ok) {
          authResult.value = {
            userId: ar.userId,
            sessionId: ar.sessionId,
            persistedEventSeq: ar.persistedEventSeq,
            userRole: workspaceRoleToSlug(ar.userRole),
          }
          state.value = 'AUTH_COMPLETE'
        } else {
          lastError.value = 'AuthResponse: ok=false'
          lastErrorKind.value = 'UNAUTHENTICATED'
          state.value = 'DISCONNECTED'
          onAuthFailCallback?.('UNAUTHENTICATED')
        }
        break
      }

      case 'serverEvent':
        onServerEventCallback?.(envelope.payload.value)
        break

      case 'sendMessageAck':
        onSendMessageAckCallback?.(envelope.payload.value)
        break

      case 'reactionAck':
        onReactionAckCallback?.(envelope.payload.value)
        break

      case 'subscribeThreadResponse':
        onSubscribeThreadResponseCallback?.(envelope.payload.value)
        break

      case 'bootstrapResponse':
        onBootstrapResponseCallback?.(envelope.payload.value)
        break

      case 'syncSinceResponse':
        onSyncSinceResponseCallback?.(envelope.payload.value)
        break

      case 'ackResponse':
        onAckResponseCallback?.(envelope.payload.value)
        break

      case 'readCursorAck':
        onReadCursorAckCallback?.(envelope.payload.value)
        break

      case 'presenceEvent':
        onPresenceEventCallback?.(envelope.payload.value)
        break

      case 'typingEvent':
        onTypingEventCallback?.(envelope.payload.value)
        break

      case 'createCallResponse':
        onCreateCallResponseCallback?.(envelope.payload.value)
        break

      case 'inviteCallMembersResponse':
        onInviteCallMembersResponseCallback?.(envelope.payload.value, envelope.requestId)
        break

      case 'joinCallTokenResponse':
        onJoinCallTokenResponseCallback?.(envelope.payload.value)
        break

      case 'callInviteActionAck':
        onCallInviteActionAckCallback?.(envelope.payload.value)
        break

      case 'setNotificationLevelResponse':
        onSetNotificationLevelResponseCallback?.(envelope.payload.value)
        break

      case 'error': {
        const err = envelope.payload.value
        onProtocolErrorCallback?.({
          requestId: envelope.requestId,
          code: err.code,
          message: err.message,
          retryAfterMs: err.retryAfterMs,
        })
        const kind = mapErrorCode(err.code)
        lastError.value = err.message || `Protocol error: ${err.code}`
        lastErrorKind.value = kind
        if (kind === 'UNAUTHENTICATED' || kind === 'FORBIDDEN') {
          state.value = 'DISCONNECTED'
          socket?.close()
          onAuthFailCallback?.(kind)
        }
        break
      }

      default:
        break
    }
  }

  function mapErrorCode(code: ErrorCode): WsErrorKind {
    switch (code) {
      case ErrorCode.UNAUTHENTICATED:
        return 'UNAUTHENTICATED'
      case ErrorCode.FORBIDDEN:
        return 'FORBIDDEN'
      case ErrorCode.BAD_REQUEST:
      case ErrorCode.CALL_NOT_ACTIVE:
        return 'BAD_REQUEST'
      default:
        return 'PROTOCOL'
    }
  }

  return {
    state,
    serverHello,
    authResult,
    lastError,
    lastErrorKind,
    lastCloseCode,
    connect,
    disconnect,
    sendAuth,
    sendMessage,
    sendAddReaction,
    sendRemoveReaction,
    sendSubscribeThread,
    sendBootstrap,
    sendSyncSince,
    sendAck,
    sendUpdateReadCursor,
    sendTyping,
    sendSetPresence,
    sendSetNotificationLevel,
    sendCreateCall,
    sendInviteCallMembers,
    sendJoinCallToken,
    sendAcceptCallInvite,
    sendRejectCallInvite,
    sendCancelCallInvite,
    setLiveSynced,
    setRecoveringGap,
    setStaleRebootstrap,
    onAuthFail,
    onTransportDrop,
    onServerHello,
    onServerEvent,
    onSendMessageAck,
    onReactionAck,
    onSubscribeThreadResponse,
    clearPendingAuthToken,
    setPendingAuthToken,
    onBootstrapResponse,
    onSyncSinceResponse,
    onAckResponse,
    onReadCursorAck,
    onPresenceEvent,
    onTypingEvent,
    onCreateCallResponse,
    onInviteCallMembersResponse,
    onJoinCallTokenResponse,
    onCallInviteActionAck,
    onSetNotificationLevelResponse,
    onProtocolError,
  }
})
