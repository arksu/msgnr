import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { EnvelopeSchema, ErrorCode, PresenceStatus, ConversationType } from '@/shared/proto/packets_pb'
import { useWsStore } from '@/stores/ws'

// Minimal WebSocket mock
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = MockWebSocket.OPEN
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  sent: Uint8Array[] = []

  send(data: ArrayBuffer | Uint8Array) {
    this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data))
  }

  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code })
  }

  simulateOpen() { this.onopen?.() }
  simulateMessage(data: ArrayBuffer) { this.onmessage?.({ data }) }
  simulateError() { this.onerror?.() }
  simulateClose(code = 1006) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code })
  }
}

function makeServerHelloEnvelope(): ArrayBuffer {
  const env = create(EnvelopeSchema, {
    requestId: '1',
    protocolVersion: 1,
    payload: {
      case: 'serverHello',
      value: {
        server: 'msgnr',
        protocolVersion: 1,
        acceptedCapabilities: [],
      },
    },
  })
  return toBinary(EnvelopeSchema, env).buffer as ArrayBuffer
}

function decodePayloadType(payload: Uint8Array | ArrayBuffer): string {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  const envelope = fromBinary(EnvelopeSchema, bytes)
  return envelope.payload.case ?? 'unknown'
}

function makeAuthResponseEnvelope(ok: boolean): ArrayBuffer {
  const env = create(EnvelopeSchema, {
    requestId: '2',
    protocolVersion: 1,
    payload: {
      case: 'authResponse',
      value: { ok, userId: 'user-1', sessionId: 'session-1', persistedEventSeq: 12n, userRole: 2 },
    },
  })
  return toBinary(EnvelopeSchema, env).buffer as ArrayBuffer
}

function makeErrorEnvelope(code: ErrorCode, message: string): ArrayBuffer {
  const env = create(EnvelopeSchema, {
    requestId: '3',
    protocolVersion: 1,
    payload: {
      case: 'error',
      value: { code, message },
    },
  })
  return toBinary(EnvelopeSchema, env).buffer as ArrayBuffer
}

function makePresenceEventEnvelope(): ArrayBuffer {
  const env = create(EnvelopeSchema, {
    requestId: '4',
    protocolVersion: 1,
    payload: {
      case: 'presenceEvent',
      value: {
        userId: 'user-2',
        effectivePresence: PresenceStatus.ONLINE,
      },
    },
  })
  return toBinary(EnvelopeSchema, env).buffer as ArrayBuffer
}

function makeInviteCallMembersResponseEnvelope(): ArrayBuffer {
  const env = create(EnvelopeSchema, {
    requestId: '5',
    protocolVersion: 1,
    payload: {
      case: 'inviteCallMembersResponse',
      value: {
        callId: 'call-1',
        conversationId: 'channel-1',
        invitedUserIds: ['user-2'],
        skippedUserIds: ['user-3'],
      },
    },
  })
  return toBinary(EnvelopeSchema, env).buffer as ArrayBuffer
}

let mockSocket: MockWebSocket
let groupCollapsedSpy: ReturnType<typeof vi.spyOn>
let consoleLogSpy: ReturnType<typeof vi.spyOn>
let groupEndSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  setActivePinia(createPinia())
  mockSocket = new MockWebSocket()
  vi.stubGlobal('WebSocket', vi.fn(function () { return mockSocket }))
  groupCollapsedSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
})

describe('wsStore state machine', () => {
  it('sends one clientHello and one authRequest for successful handshake', () => {
    const store = useWsStore()
    store.setPendingAuthToken('jwt-token')
    store.connect('/ws')
    mockSocket.simulateOpen()

    mockSocket.simulateMessage(makeServerHelloEnvelope())

    expect(mockSocket.sent.length).toBe(2)
    expect(decodePayloadType(mockSocket.sent[0])).toBe('clientHello')
    expect(decodePayloadType(mockSocket.sent[1])).toBe('authRequest')
  })

  it('DISCONNECTED -> HELLO_SENT on connect+open', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    expect(store.state).toBe('HELLO_SENT')
  })

  it('HELLO_SENT -> HELLO_COMPLETE on serverHello', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeServerHelloEnvelope())
    expect(store.state).toBe('HELLO_COMPLETE')
    expect(store.serverHello?.case).toBe('serverHello')
  })

  it('invokes onServerHello callback exactly once', () => {
    const store = useWsStore()
    const onHello = vi.fn()
    store.onServerHello(onHello)

    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeServerHelloEnvelope())
    mockSocket.simulateMessage(makeServerHelloEnvelope())

    expect(onHello).toHaveBeenCalledTimes(1)
    expect(store.state).toBe('HELLO_COMPLETE')
  })

  it('HELLO_COMPLETE -> AUTH_SENT on sendAuth', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeServerHelloEnvelope())
    store.sendAuth('my-access-token')
    expect(store.state).toBe('AUTH_SENT')
    expect(mockSocket.sent.length).toBeGreaterThan(1) // hello + auth
  })

  it('logs outgoing packets in a readable format', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()

    store.sendAck(42n)

    expect(groupCollapsedSpy.mock.calls.some(([message]: [string]) => message === '[WS SEND] ackRequest')).toBe(true)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        case: 'ackRequest',
        value: expect.objectContaining({
          lastAppliedEventSeq: '42',
        }),
      }),
    }))
    expect(groupEndSpy).toHaveBeenCalled()
  })

  it('sends updateReadCursor requests', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()

    store.sendUpdateReadCursor('channel-1', 9n)

    expect(groupCollapsedSpy.mock.calls.some(([message]: [string]) => message === '[WS SEND] updateReadCursorRequest')).toBe(true)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        case: 'updateReadCursorRequest',
        value: expect.objectContaining({
          conversationId: 'channel-1',
          lastReadSeq: '9',
        }),
      }),
    }))
  })

  it('AUTH_SENT -> AUTH_COMPLETE on authResponse ok=true', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeServerHelloEnvelope())
    store.sendAuth('my-access-token')
    mockSocket.simulateMessage(makeAuthResponseEnvelope(true))
    expect(store.state).toBe('AUTH_COMPLETE')
    expect(store.authResult?.userId).toBe('user-1')
    expect(store.authResult?.sessionId).toBe('session-1')
    expect(store.authResult?.persistedEventSeq).toBe(12n)
    expect(store.authResult?.userRole).toBe('admin')
  })

  it('logs incoming packets in a readable format', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeServerHelloEnvelope())
    store.sendAuth('my-access-token')

    mockSocket.simulateMessage(makeAuthResponseEnvelope(true))

    expect(groupCollapsedSpy.mock.calls.some(([message]: [string]) => message === '[WS RECV] authResponse')).toBe(true)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        case: 'authResponse',
        value: expect.objectContaining({
          persistedEventSeq: '12',
        }),
      }),
    }))
    expect(groupEndSpy).toHaveBeenCalled()
  })

  it('transitions to BOOTSTRAPPING when bootstrap starts after auth', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeServerHelloEnvelope())
    store.sendAuth('my-access-token')
    mockSocket.simulateMessage(makeAuthResponseEnvelope(true))

    store.sendBootstrap({ clientInstanceId: 'client-1' })

    expect(store.state).toBe('BOOTSTRAPPING')
  })

  it('transitions to DISCONNECTED on UNAUTHENTICATED error and calls onAuthFail', () => {
    const store = useWsStore()
    const onFail = vi.fn()
    store.onAuthFail(onFail)

    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeServerHelloEnvelope())
    store.sendAuth('bad-token')
    mockSocket.simulateMessage(makeErrorEnvelope(ErrorCode.UNAUTHENTICATED, 'unauthenticated'))

    expect(store.state).toBe('DISCONNECTED')
    expect(store.lastErrorKind).toBe('UNAUTHENTICATED')
    expect(onFail).toHaveBeenCalledWith('UNAUTHENTICATED')
  })

  it('transitions to DISCONNECTED on FORBIDDEN error and calls onAuthFail', () => {
    const store = useWsStore()
    const onFail = vi.fn()
    store.onAuthFail(onFail)

    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeServerHelloEnvelope())
    store.sendAuth('blocked-token')
    mockSocket.simulateMessage(makeErrorEnvelope(ErrorCode.FORBIDDEN, 'forbidden'))

    expect(store.state).toBe('DISCONNECTED')
    expect(store.lastErrorKind).toBe('FORBIDDEN')
    expect(onFail).toHaveBeenCalledWith('FORBIDDEN')
  })

  it('transport error transitions to DISCONNECTED', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateError()
    expect(store.state).toBe('DISCONNECTED')
    expect(store.lastErrorKind).toBe('TRANSPORT')
  })

  it('stores last close code and clears it on next connect', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateClose(1006)

    expect(store.lastCloseCode).toBe(1006)
    expect(store.state).toBe('DISCONNECTED')

    store.connect('/ws')
    expect(store.lastCloseCode).toBeNull()
  })

  it('rejects malformed binary data gracefully', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()
    const garbage = new Uint8Array([0xff, 0xfe, 0x00]).buffer as ArrayBuffer
    mockSocket.simulateMessage(garbage)
    expect(store.lastErrorKind).toBe('PROTOCOL')
    // state should still be HELLO_SENT (not crash)
    expect(store.state).toBe('HELLO_SENT')
  })

  it('routes direct presence events to the registered callback', () => {
    const store = useWsStore()
    const onPresence = vi.fn()
    store.onPresenceEvent(onPresence)

    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makePresenceEventEnvelope())

    expect(onPresence).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      effectivePresence: PresenceStatus.ONLINE,
    }))
  })

  it('sends inviteCallMembersRequest envelopes', () => {
    const store = useWsStore()
    store.connect('/ws')
    mockSocket.simulateOpen()

    store.sendInviteCallMembers('channel-1', ConversationType.CHANNEL_PUBLIC, ['user-2', 'user-3'])

    const lastSent = mockSocket.sent[mockSocket.sent.length - 1]
    const envelope = fromBinary(EnvelopeSchema, lastSent)
    expect(envelope.payload.case).toBe('inviteCallMembersRequest')
    expect(envelope.payload.value).toEqual(expect.objectContaining({
      conversationId: 'channel-1',
      conversationType: ConversationType.CHANNEL_PUBLIC,
      inviteeUserIds: ['user-2', 'user-3'],
    }))
  })

  it('routes inviteCallMembersResponse to the registered callback', () => {
    const store = useWsStore()
    const onInviteResponse = vi.fn()
    store.onInviteCallMembersResponse(onInviteResponse)

    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeInviteCallMembersResponseEnvelope())

    expect(onInviteResponse).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'call-1',
      conversationId: 'channel-1',
      invitedUserIds: ['user-2'],
      skippedUserIds: ['user-3'],
    }), '5')
  })

  it('routes protocol error envelopes to the registered callback with request id', () => {
    const store = useWsStore()
    const onProtocolError = vi.fn()
    store.onProtocolError(onProtocolError)

    store.connect('/ws')
    mockSocket.simulateOpen()
    mockSocket.simulateMessage(makeErrorEnvelope(ErrorCode.CALL_NOT_ACTIVE, 'call is not active'))

    expect(onProtocolError).toHaveBeenCalledWith(expect.objectContaining({
      requestId: '3',
      code: ErrorCode.CALL_NOT_ACTIVE,
      message: 'call is not active',
    }))
  })
})
