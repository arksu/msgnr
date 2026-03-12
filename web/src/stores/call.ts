import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { ConversationType, ErrorCode } from '@/shared/proto/packets_pb'
import { Room, RoomEvent, Track, ScreenSharePresets, type AudioCaptureOptions, type LocalVideoTrack, type LocalAudioTrack, type TrackPublishOptions, type ScreenShareCaptureOptions } from 'livekit-client'
import { useWsStore } from '@/stores/ws'
import { useChatStore } from '@/stores/chat'
import { useNotificationSoundEngine } from '@/services/sound'
import { loadAudioPrefs } from '@/services/storage/audioPrefsStorage'
import { getPlatformOrNull } from '@/platform'

// RNNoise blob URL is built once per page load and reused across all mute/unmute
// cycles. Fetching + Blob-URL creation is expensive (~network round trip + WASM
// compilation inside the worklet) so we cache the result at module scope.
let rnnoiseBlobUrlPromise: Promise<string> | null = null

function getRnnoiseBlobUrl(): Promise<string> {
  if (!rnnoiseBlobUrlPromise) {
    rnnoiseBlobUrlPromise = (async () => {
      const [rnnoiseJs, processorJs] = await Promise.all([
        fetch('/rnnoise-classic.js').then(r => {
          if (!r.ok) throw new Error(`Failed to fetch rnnoise-classic.js: ${r.status}`)
          return r.text()
        }),
        fetch('/rnnoise-processor.js').then(r => {
          if (!r.ok) throw new Error(`Failed to fetch rnnoise-processor.js: ${r.status}`)
          return r.text()
        }),
      ])
      const blob = new Blob([rnnoiseJs + '\n' + processorJs], { type: 'application/javascript' })
      return URL.createObjectURL(blob)
    })().catch(err => {
      // Reset so the next call retries (e.g. transient network error)
      rnnoiseBlobUrlPromise = null
      throw err
    })
  }
  return rnnoiseBlobUrlPromise
}

const JOIN_TOKEN_TIMEOUT_MS = 8000
const INVITE_CALL_MEMBERS_TIMEOUT_MS = 8000
const JOIN_ROOM_CONNECT_TIMEOUT_MS = 15000
const REMOTE_AUDIO_STATS_INTERVAL_MS = 3000
const EMPTY_CALL_AUTO_CLOSE_MS = 5000
const CALL_DEBUG_STORAGE_KEY = 'debug.calls'

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function normalizeLiveKitUrl(rawUrl: string): string {
  const urlValue = rawUrl.trim()
  if (!urlValue) {
    throw new Error('Join token response has empty livekitUrl')
  }

  let parsed: URL
  try {
    parsed = new URL(urlValue)
  } catch (err) {
    throw new Error('Join token response has invalid livekitUrl')
  }

  if (window.location.protocol === 'https:' && parsed.protocol === 'ws:') {
    parsed = new URL(parsed.href.replace(/^ws:/, 'wss:'))
  }

  if (parsed.protocol === 'http:') {
    parsed = new URL(parsed.href.replace(/^http:/, 'ws:'))
  }

  if (parsed.protocol === 'https:') {
    parsed = new URL(parsed.href.replace(/^https:/, 'wss:'))
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('Join token response uses unsupported livekitUrl protocol')
  }

  if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(window.location.hostname)) {
    const fallbackHost = window.location.hostname
    const fallbackPort = parsed.port || '7880'
    const fallbackProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const normalized = new URL(parsed.pathname || '/', `${fallbackProtocol}//${fallbackHost}:${fallbackPort}`)
    normalized.hash = parsed.hash
    normalized.search = parsed.search
    return normalized.toString()
  }

  return parsed.toString()
}

function toConversationType(kind: 'dm' | 'channel', visibility: 'public' | 'private' | 'dm'): ConversationType {
  if (kind === 'dm') return ConversationType.DM
  if (visibility === 'private') return ConversationType.CHANNEL_PRIVATE
  return ConversationType.CHANNEL_PUBLIC
}

function getMediaDevices(): MediaDevices | null {
  if (typeof globalThis === 'undefined') return null
  const nav = globalThis.navigator as Navigator | undefined
  return nav && nav.mediaDevices ? nav.mediaDevices : null
}

function hasGetUserMedia(): boolean {
  const devices = getMediaDevices()
  return Boolean(devices && typeof devices.getUserMedia === 'function')
}

function mediaUnavailableMessage(): string {
  return 'Media devices are not available in this browser. Join without microphone/camera or switch to HTTPS.'
}

function isCallDebugEnabled(): boolean {
  const envEnabled = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CALL_DEBUG === '1'
  if (envEnabled) return true
  try {
    return globalThis.localStorage?.getItem(CALL_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function callDebug(message: string, payload?: unknown) {
  if (!isCallDebugEnabled()) return
  if (typeof payload === 'undefined') {
    console.info(`[call-debug] ${message}`)
    return
  }
  console.info(`[call-debug] ${message}`, payload)
}

function isScreenSource(source: unknown): boolean {
  return String(source ?? '').toLowerCase().includes('screen')
}

function logScreenShare(message: string, payload?: unknown) {
  if (typeof payload === 'undefined') {
    console.info(`[call-screen] ${message}`)
    return
  }
  console.info(`[call-screen] ${message}`, payload)
}

export const useCallStore = defineStore('call', () => {
  const room = shallowRef<Room | null>(null)
  const activeConversationId = ref('')
  const activeConversationKind = ref<'dm' | 'channel'>('channel')
  const activeConversationVisibility = ref<'public' | 'private' | 'dm'>('public')
  const activeCallId = ref('')
  const activeRoomName = ref('')
  const connecting = ref(false)
  const connected = ref(false)
  const minimized = ref(false)
  const micEnabled = ref(false)
  const cameraEnabled = ref(false)
  const screenShareEnabled = ref(false)
  const remoteParticipantCount = ref(0)
  const mediaVersion = ref(0)

  // True when any remote participant is actively sharing a screen track.
  // Reads mediaVersion to re-evaluate whenever track publications change.
  const remoteScreenShareActive = computed(() => {
    void mediaVersion.value
    const current = room.value
    if (!current) return false
    for (const participant of current.remoteParticipants.values()) {
      for (const pub of participant.videoTrackPublications.values()) {
        if (isScreenSource(pub.source) && pub.track && !pub.isMuted) return true
      }
    }
    return false
  })
  const activeSpeakerSids = ref<Set<string>>(new Set())
  const playbackBlocked = ref(false)
  const errorMessage = ref('')

  const chatStore = useChatStore()
  const soundEngine = useNotificationSoundEngine()
  const platform = getPlatformOrNull()

  let pendingJoinResolve: ((resp: { livekitUrl: string; livekitToken: string; livekitRoom: string }) => void) | null = null
  let pendingJoinReject: ((error: Error) => void) | null = null
  let pendingJoinTimer: ReturnType<typeof setTimeout> | null = null
  let pendingInviteMembersResolve: ((resp: { callId: string; conversationId: string; invitedUserIds: string[]; skippedUserIds: string[] }) => void) | null = null
  let pendingInviteMembersReject: ((error: Error) => void) | null = null
  let pendingInviteMembersTimer: ReturnType<typeof setTimeout> | null = null
  let pendingInviteMembersRequestId = ''
  let remoteAudioStatsTimer: ReturnType<typeof setInterval> | null = null
  let emptyCallAutoCloseTimer: ReturnType<typeof setTimeout> | null = null
  let audioProcessingCleanup: (() => void) | null = null
  let knownRemoteParticipantSids = new Set<string>()
  let suppressParticipantChangeSounds = false

  const activeConversationTitle = computed(() => {
    const channel = chatStore.channels.find(item => item.id === activeConversationId.value)
    if (channel) return channel.name
    const dm = chatStore.directMessages.find(item => item.id === activeConversationId.value)
    if (dm) return dm.displayName
    return 'Call'
  })

  function clearPendingJoin() {
    if (pendingJoinTimer) {
      clearTimeout(pendingJoinTimer)
      pendingJoinTimer = null
    }
    pendingJoinResolve = null
    pendingJoinReject = null
  }

  function clearPendingInviteMembers() {
    if (pendingInviteMembersTimer) {
      clearTimeout(pendingInviteMembersTimer)
      pendingInviteMembersTimer = null
    }
    pendingInviteMembersResolve = null
    pendingInviteMembersReject = null
    pendingInviteMembersRequestId = ''
  }

  function stopRemoteAudioStatsLoop() {
    if (remoteAudioStatsTimer) {
      clearInterval(remoteAudioStatsTimer)
      remoteAudioStatsTimer = null
    }
  }

  function clearEmptyCallAutoCloseTimer() {
    if (emptyCallAutoCloseTimer) {
      clearTimeout(emptyCallAutoCloseTimer)
      emptyCallAutoCloseTimer = null
    }
  }

  function syncKnownRemoteParticipants(current: Room) {
    knownRemoteParticipantSids = new Set(
      Array.from(current.remoteParticipants.values()).map(participant => participant.sid),
    )
  }

  function scheduleEmptyCallAutoClose() {
    clearEmptyCallAutoCloseTimer()

    if (!connected.value) return
    if (remoteParticipantCount.value > 0) return
    if (!activeConversationId.value) return

    const shouldCloseIfStillEmpty = () => {
      if (!connected.value) return
      if (!activeConversationId.value) return
      if (remoteParticipantCount.value > 0) return
      if (chatStore.activeCalls.some(call => call.conversationId === activeConversationId.value)) return

      callDebug('auto closing empty call', {
        conversationId: activeConversationId.value,
        remoteParticipantCount: remoteParticipantCount.value,
      })
      void leaveCall()
    }

    emptyCallAutoCloseTimer = setTimeout(shouldCloseIfStillEmpty, EMPTY_CALL_AUTO_CLOSE_MS)
  }

  async function logRemoteAudioStatsSnapshot(current: Room) {
    const snapshot: Array<Record<string, unknown>> = []
    for (const participant of current.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        const track = publication.track as {
          sid?: string
          kind?: string
          getReceiverStats?: () => Promise<Record<string, unknown> | undefined>
        } | null
        const entry: Record<string, unknown> = {
          participantIdentity: participant.identity,
          participantSid: participant.sid,
          publicationSid: publication.trackSid,
          publicationName: publication.trackName,
          subscribed: publication.isSubscribed,
          muted: publication.isMuted,
          hasTrack: Boolean(track),
          trackSid: track?.sid ?? null,
          trackKind: track?.kind ?? null,
        }
        if (track && typeof track.getReceiverStats === 'function') {
          try {
            const stats = await track.getReceiverStats()
            entry.receiverStats = stats
          } catch (err) {
            entry.statsError = err instanceof Error ? err.message : String(err)
          }
        }
        snapshot.push(entry)
      }
    }

    callDebug('remote audio stats snapshot', {
      room: current.name,
      canPlaybackAudio: current.canPlaybackAudio,
      remoteParticipantCount: current.remoteParticipants.size,
      tracks: snapshot,
    })
  }

  function startRemoteAudioStatsLoop(current: Room) {
    stopRemoteAudioStatsLoop()
    if (!isCallDebugEnabled()) return
    void logRemoteAudioStatsSnapshot(current)
    remoteAudioStatsTimer = setInterval(() => {
      void logRemoteAudioStatsSnapshot(current)
    }, REMOTE_AUDIO_STATS_INTERVAL_MS)
  }

  function logLocalVideoPublications(current: Room, stage: string) {
    const publications = Array.from(current.localParticipant.videoTrackPublications.values()).map((publication) => ({
      trackSid: publication.trackSid,
      source: publication.source,
      muted: publication.isMuted,
      hasTrack: Boolean(publication.track),
      trackKind: publication.track?.kind ?? null,
    }))
    logScreenShare(`local video publications (${stage})`, publications)
  }

  function logRemoteVideoPublications(current: Room, stage: string) {
    const publications = Array.from(current.remoteParticipants.values()).flatMap(participant =>
      Array.from(participant.videoTrackPublications.values()).map(publication => ({
        participant: participant.identity,
        participantSid: participant.sid,
        trackSid: publication.trackSid,
        source: publication.source,
        subscribed: publication.isSubscribed,
        muted: publication.isMuted,
        hasTrack: Boolean(publication.track),
        trackKind: publication.track?.kind ?? null,
      }))
    )
    logScreenShare(`remote video publications (${stage})`, publications)
  }

  function buildAudioCaptureOptions(): AudioCaptureOptions {
    const prefs = loadAudioPrefs()
    const opts: AudioCaptureOptions = {
      // When RNNoise is active it handles noise suppression; disable the browser's
      // native implementation to avoid double-processing.
      noiseSuppression: prefs.rnnoiseEnabled ? false : prefs.noiseSuppression,
      echoCancellation: prefs.echoCancellation,
      autoGainControl: prefs.autoGainControl,
      // Explicitly request mono capture. All voice processing (AEC, NS, AGC,
      // RNNoise) operates on a single channel. Bluetooth headsets (AirPods,
      // HFP/HSP profile) deliver a mono SCO link regardless, so specifying 1
      // here makes intent clear and prevents unexpected stereo on multi-mic
      // devices (e.g. laptop beamforming arrays).
      channelCount: 1,
    }
    if (prefs.inputDeviceId) {
      opts.deviceId = prefs.inputDeviceId
    }
    return opts
  }

  // Builds the complete audio post-processing pipeline in a single AudioContext
  // and replaces the track LiveKit is sending with the processed output.
  //
  // Pipeline (left to right):
  //   raw mic → GainNode (if !autoGainControl && gain ≠ 100)
  //           → AudioWorkletNode/RNNoise (if rnnoiseEnabled)
  //           → MediaStreamDestination → replaceTrack
  //
  // Gain is applied BEFORE noise suppression so RNNoise receives a well-levelled
  // signal. Its VAD is level-dependent — a signal that is too quiet causes
  // speech frames to be misclassified as noise and suppressed.
  //
  // Both stages share one AudioContext and one replaceTrack() call, which avoids
  // the previous bug where two independent replaceTrack() calls raced each other
  // and the second one silently discarded the first stage's output.
  //
  // The RNNoise blob URL is cached at module scope via getRnnoiseBlobUrl() so
  // the JS files are only downloaded once per page load.
  //
  // Returns a cleanup function that tears down the AudioContext on call leave.
  async function applyAudioProcessing(
    publication: LocalAudioTrack,
    prefs: { autoGainControl: boolean; microphoneGain: number; rnnoiseEnabled: boolean },
  ): Promise<() => void> {
    // Always read _mediaStreamTrack directly (not via the .mediaStreamTrack
    // getter) so we get the original raw capture track rather than any
    // previously replaced/processed track.
    const rawTrack = (publication as unknown as { _mediaStreamTrack: MediaStreamTrack })._mediaStreamTrack
      ?? publication.mediaStreamTrack

    const applyGain = !prefs.autoGainControl && prefs.microphoneGain !== 100

    // If neither stage is needed, there is nothing to do.
    if (!applyGain && !prefs.rnnoiseEnabled) {
      return () => {}
    }

    const ctx = new AudioContext()
    try {
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]))
      let current: AudioNode = source

      // Mono node options shared by every processing stage.
      // channelCountMode:'explicit' locks channel count to exactly 1 at every
      // node so the pipeline never silently up-mixes mid-chain.
      const monoNodeOptions: AudioNodeOptions = {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      }

      // Stage 1 — gain (must come before noise suppression)
      if (applyGain) {
        const gainNode = new GainNode(ctx, monoNodeOptions)
        gainNode.gain.value = prefs.microphoneGain / 100
        current.connect(gainNode)
        current = gainNode
      }

      // Stage 2 — RNNoise WASM noise suppression
      if (prefs.rnnoiseEnabled) {
        const blobUrl = await getRnnoiseBlobUrl()
        await ctx.audioWorklet.addModule(blobUrl)
        const workletNode = new AudioWorkletNode(ctx, 'rnnoise-processor', {
          ...monoNodeOptions,
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        })
        current.connect(workletNode)
        current = workletNode
      }

      // MediaStreamAudioDestinationNode defaults to 2 channels (stereo).
      // Web Audio spec §4.4 mono→stereo upmix: L = M, R = M.
      // Connecting the 1-ch pipeline output here automatically fills both
      // channels with the same signal — remote participants hear audio on
      // both sides regardless of which physical mic they used.
      const dest = ctx.createMediaStreamDestination()
      current.connect(dest)

      const processedTrack = dest.stream.getAudioTracks()[0]
      await publication.replaceTrack(processedTrack, true)

      return () => {
        // Stop both the processed output track and the raw mic track.
        // This cleanup is only called on call leave (ensureDisconnected) —
        // never during a mute/unmute cycle. Stopping rawTrack releases the
        // browser microphone indicator. AudioContext.close() alone does NOT
        // stop the underlying MediaStreamTrack.
        processedTrack.stop()
        rawTrack.stop()
        ctx.close().catch(() => {})
      }
    } catch (err) {
      console.error('[call] applyAudioProcessing failed:', err)
      ctx.close().catch(() => {})
      throw err
    }
  }

  function createRoom(): Room {
    const next = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: buildAudioCaptureOptions(),
    })

    next.on(RoomEvent.Disconnected, () => {
      callDebug('room disconnected', {
        room: next.name,
        canPlaybackAudio: next.canPlaybackAudio,
      })
      stopRemoteAudioStatsLoop()
      connected.value = false
      connecting.value = false
      cameraEnabled.value = false
      screenShareEnabled.value = false
      micEnabled.value = false
      remoteParticipantCount.value = 0
      mediaVersion.value += 1
      activeSpeakerSids.value = new Set()
      playbackBlocked.value = false
      activeCallId.value = ''
      activeRoomName.value = ''
      activeConversationId.value = ''
      activeConversationKind.value = 'channel'
      activeConversationVisibility.value = 'public'
      room.value = null
      clearEmptyCallAutoCloseTimer()
      knownRemoteParticipantSids.clear()
      suppressParticipantChangeSounds = false
    })

    next.on(RoomEvent.Connected, () => {
      callDebug('room connected', {
        room: next.name,
        localParticipant: next.localParticipant.identity,
        canPlaybackAudio: next.canPlaybackAudio,
      })
      remoteParticipantCount.value = next.remoteParticipants.size
      syncKnownRemoteParticipants(next)
      suppressParticipantChangeSounds = false
      mediaVersion.value += 1
      clearEmptyCallAutoCloseTimer()
      if (remoteParticipantCount.value === 0) {
        scheduleEmptyCallAutoClose()
      }
    })

    next.on(RoomEvent.Reconnecting, () => {
      callDebug('room reconnecting', { room: next.name })
    })

    next.on(RoomEvent.Reconnected, () => {
      callDebug('room reconnected', {
        room: next.name,
        canPlaybackAudio: next.canPlaybackAudio,
      })
      remoteParticipantCount.value = next.remoteParticipants.size
      syncKnownRemoteParticipants(next)
      suppressParticipantChangeSounds = false
      mediaVersion.value += 1
      if (remoteParticipantCount.value === 0) {
        scheduleEmptyCallAutoClose()
      } else {
        clearEmptyCallAutoCloseTimer()
      }
    })

    next.on(RoomEvent.ParticipantConnected, (participant) => {
      const isKnownParticipant = knownRemoteParticipantSids.has(participant.sid)
      knownRemoteParticipantSids.add(participant.sid)

      for (const publication of participant.audioTrackPublications.values()) {
        if (!publication.isSubscribed) {
          callDebug('forcing remote audio subscribe on participant connect', {
            participant: participant.identity,
            trackSid: publication.trackSid,
          })
          publication.setSubscribed(true)
        }
      }
      for (const publication of participant.videoTrackPublications.values()) {
        if (!publication.isSubscribed) {
          callDebug('forcing remote video subscribe on participant connect', {
            participant: participant.identity,
            participantSid: participant.sid,
            trackSid: publication.trackSid,
            source: publication.source,
          })
          publication.setSubscribed(true)
        }
      }
      callDebug('remote participant connected', {
        participant: participant.identity,
        sid: participant.sid,
        remoteParticipantCount: next.remoteParticipants.size,
      })
      remoteParticipantCount.value = next.remoteParticipants.size
      clearEmptyCallAutoCloseTimer()
      mediaVersion.value += 1
      if (!isKnownParticipant && connected.value && !suppressParticipantChangeSounds) {
        if (platform?.type === 'tauri') {
          void platform.notifications.playSound?.('call-member-joined')
        } else {
          void soundEngine.playCallMemberJoined()
        }
      }
    })

    next.on(RoomEvent.ParticipantDisconnected, (participant) => {
      const isKnownParticipant = knownRemoteParticipantSids.delete(participant.sid)
      callDebug('remote participant disconnected', {
        participant: participant.identity,
        sid: participant.sid,
        remoteParticipantCount: next.remoteParticipants.size,
      })
      remoteParticipantCount.value = next.remoteParticipants.size
      if (remoteParticipantCount.value === 0) {
        scheduleEmptyCallAutoClose()
      }
      mediaVersion.value += 1
      if (isKnownParticipant && connected.value && !suppressParticipantChangeSounds) {
        if (platform?.type === 'tauri') {
          void platform.notifications.playSound?.('call-member-left')
        } else {
          void soundEngine.playCallMemberLeft()
        }
      }
    })

    next.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      callDebug('track subscribed', {
        participant: participant.identity,
        publicationSid: publication.trackSid,
        kind: track.kind,
        source: publication.source,
        muted: publication.isMuted,
      })
      if (isScreenSource(publication.source)) {
        logScreenShare('remote screen track subscribed', {
          participant: participant.identity,
          participantSid: participant.sid,
          trackSid: publication.trackSid,
          muted: publication.isMuted,
          hasTrack: Boolean(publication.track),
        })
        logRemoteVideoPublications(next, 'track-subscribed')
      }
      mediaVersion.value += 1
    })

    next.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      callDebug('track unsubscribed', {
        participant: participant.identity,
        publicationSid: publication.trackSid,
        kind: track.kind,
        source: publication.source,
      })
      if (isScreenSource(publication.source)) {
        logScreenShare('remote screen track unsubscribed', {
          participant: participant.identity,
          participantSid: participant.sid,
          trackSid: publication.trackSid,
        })
        logRemoteVideoPublications(next, 'track-unsubscribed')
      }
      mediaVersion.value += 1
    })

    next.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (!participant.isLocal && !publication.isSubscribed) {
        callDebug('forcing remote track subscribe on track publish', {
          participant: participant.identity,
          trackSid: publication.trackSid,
          kind: publication.kind,
          source: publication.source,
        })
        publication.setSubscribed(true)
      }
      callDebug('track published event', {
        participant: participant.identity,
        publicationSid: publication.trackSid,
        kind: publication.kind,
        source: publication.source,
        subscribed: publication.isSubscribed,
        muted: publication.isMuted,
      })
      if (isScreenSource(publication.source)) {
        logScreenShare('track published with screen source', {
          participant: participant.identity,
          participantSid: participant.sid,
          trackSid: publication.trackSid,
          subscribed: publication.isSubscribed,
          hasTrack: Boolean(publication.track),
        })
        logRemoteVideoPublications(next, 'track-published')
      }
      mediaVersion.value += 1
    })

    next.on(RoomEvent.TrackSubscriptionFailed, (trackSid, participant) => {
      logScreenShare('track subscription failed', {
        trackSid,
        participant: participant.identity,
        participantSid: participant.sid,
      })
    })

    next.on(RoomEvent.LocalTrackPublished, (publication) => {
      mediaVersion.value += 1
      if (isScreenSource(publication.source)) {
        logScreenShare('local screen track published', {
          trackSid: publication.trackSid,
          source: publication.source,
          muted: publication.isMuted,
          hasTrack: Boolean(publication.track),
        })
        logLocalVideoPublications(next, 'local-track-published')
      }
    })

    next.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      mediaVersion.value += 1
      if (isScreenSource(publication.source)) {
        logScreenShare('local screen track unpublished', {
          trackSid: publication.trackSid,
          source: publication.source,
        })
        logLocalVideoPublications(next, 'local-track-unpublished')
      }
      // When the ScreenShare video track is unpublished via Safari's native
      // "Stop Sharing" toolbar button, Safari fires 'ended' on the track.
      // LiveKit's handleTrackEnded unpublishes only that one track, so:
      //   1. screenShareEnabled is never reset — UI stays stuck in "sharing" state.
      //   2. The ScreenShareAudio companion track is left published/live —
      //      Safari keeps showing the audio capture indicator indefinitely.
      if (publication.source === Track.Source.ScreenShare) {
        screenShareEnabled.value = false
        const audioPublication = next.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
        if (audioPublication?.track) {
          next.localParticipant.unpublishTrack(audioPublication.track)
        }
      }
    })

    next.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      callDebug('audio playback status changed', {
        canPlaybackAudio: next.canPlaybackAudio,
      })
      playbackBlocked.value = !next.canPlaybackAudio
    })

    next.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      activeSpeakerSids.value = new Set(speakers.map(s => s.sid))
      mediaVersion.value += 1
    })

    return next
  }

  function ensureRemoteTracksSubscribed(current: Room) {
    for (const participant of current.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        if (!publication.isSubscribed) {
          callDebug('forcing remote audio subscribe during sync', {
            participant: participant.identity,
            trackSid: publication.trackSid,
          })
          publication.setSubscribed(true)
        }
      }
      for (const publication of participant.videoTrackPublications.values()) {
        if (!publication.isSubscribed) {
          callDebug('forcing remote video subscribe during sync', {
            participant: participant.identity,
            participantSid: participant.sid,
            trackSid: publication.trackSid,
            source: publication.source,
          })
          publication.setSubscribed(true)
        }
      }
    }
  }

  function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(message))
      }, ms)
      void promise.then(
        (result) => {
          clearTimeout(timeout)
          resolve(result)
        },
        (err) => {
          clearTimeout(timeout)
          reject(err)
        },
      )
    })
  }

  async function ensureDisconnected() {
    suppressParticipantChangeSounds = true
    audioProcessingCleanup?.()
    audioProcessingCleanup = null
    const current = room.value
    clearPendingJoin()
    stopRemoteAudioStatsLoop()
    clearEmptyCallAutoCloseTimer()
    if (!current) return
    try {
      console.info('[call-leave] disconnecting room', {
        room: current.name,
        conversationId: activeConversationId.value,
        activeCallId: activeCallId.value,
      })
      callDebug('disconnecting room', { room: current.name })
      await current.disconnect()
      console.info('[call-leave] disconnect resolved', {
        room: current.name,
      })
    } catch {
      // best effort
    }
    room.value = null
    knownRemoteParticipantSids.clear()
    suppressParticipantChangeSounds = false
  }

  async function requestJoinToken(conversationId: string, kind: 'dm' | 'channel', visibility: 'public' | 'private' | 'dm') {
    const ws = useWsStore()
    if (pendingJoinResolve || pendingJoinReject) {
      throw new Error('join token request already in flight')
    }
    callDebug('requesting join token', { conversationId, kind, visibility })

    const response = await new Promise<{ livekitUrl: string; livekitToken: string; livekitRoom: string }>((resolve, reject) => {
      pendingJoinResolve = resolve
      pendingJoinReject = reject
      pendingJoinTimer = setTimeout(() => {
        clearPendingJoin()
        reject(new Error('Timed out waiting for join token'))
      }, JOIN_TOKEN_TIMEOUT_MS)
      ws.sendJoinCallToken(conversationId, toConversationType(kind, visibility))
    })
    callDebug('join token received', {
      conversationId,
      room: response.livekitRoom,
      livekitUrl: response.livekitUrl,
    })

    return response
  }

  function resolveActiveConversationType(): { kind: 'dm' | 'channel'; visibility: 'public' | 'private' | 'dm' } | null {
    const conversationId = activeConversationId.value
    if (!conversationId) return null
    const channel = chatStore.channels.find(item => item.id === conversationId)
    if (channel) {
      return {
        kind: 'channel',
        visibility: channel.visibility,
      }
    }
    const dm = chatStore.directMessages.find(item => item.id === conversationId)
    if (dm) {
      return {
        kind: 'dm',
        visibility: 'dm',
      }
    }
    return {
      kind: activeConversationKind.value,
      visibility: activeConversationVisibility.value,
    }
  }

  async function inviteMembersToActiveCall(userIds: string[]) {
    const ws = useWsStore()
    if (!activeConversationId.value) {
      throw new Error('No active conversation for call invite')
    }
    const conversationMeta = resolveActiveConversationType()
    if (!conversationMeta) {
      throw new Error('Unable to resolve active conversation type')
    }
    if (pendingInviteMembersResolve || pendingInviteMembersReject) {
      throw new Error('call invite request already in flight')
    }

    const response = await new Promise<{ callId: string; conversationId: string; invitedUserIds: string[]; skippedUserIds: string[] }>((resolve, reject) => {
      pendingInviteMembersResolve = resolve
      pendingInviteMembersReject = reject
      pendingInviteMembersTimer = setTimeout(() => {
        clearPendingInviteMembers()
        reject(new Error('Timed out waiting for call invite response'))
      }, INVITE_CALL_MEMBERS_TIMEOUT_MS)
      pendingInviteMembersRequestId = ws.sendInviteCallMembers(
        activeConversationId.value,
        toConversationType(conversationMeta.kind, conversationMeta.visibility),
        userIds,
      )
    })
    clearPendingInviteMembers()
    return {
      invitedUserIds: response.invitedUserIds,
      skippedUserIds: response.skippedUserIds,
    }
  }

  async function startOrJoinCall(args: {
    conversationId: string
    kind: 'dm' | 'channel'
    visibility: 'public' | 'private' | 'dm'
    inviteeUserIds?: string[]
    joinExistingOnly?: boolean
  }) {
    const ws = useWsStore()
    const { conversationId, kind, visibility } = args
    const inviteeUserIds = args.inviteeUserIds ?? []
    const joinExistingOnly = args.joinExistingOnly ?? false
    const currentActive = chatStore.activeCalls.find(call => call.conversationId === conversationId)
    callDebug('startOrJoinCall invoked', {
      conversationId,
      kind,
      visibility,
      inviteeUserIds,
      joinExistingOnly,
      joiningExistingCall: Boolean(currentActive),
    })
    activeConversationKind.value = kind
    activeConversationVisibility.value = visibility

    errorMessage.value = ''
    connecting.value = true
    clearEmptyCallAutoCloseTimer()

    try {
      if (!currentActive && !joinExistingOnly) {
        ws.sendCreateCall(conversationId, toConversationType(kind, visibility), inviteeUserIds)
      }

      const join = await requestJoinToken(conversationId, kind, visibility)
      const normalizedLiveKitUrl = normalizeLiveKitUrl(join.livekitUrl)
      if (!join.livekitToken) {
        throw new Error('Join token response has empty livekitToken')
      }
      callDebug('join token normalized', {
        conversationId,
        requestedUrl: join.livekitUrl,
        resolvedUrl: normalizedLiveKitUrl,
        room: join.livekitRoom,
      })

      await ensureDisconnected()
      const canUseMediaDevices = hasGetUserMedia()

      const nextRoom = createRoom()
      room.value = nextRoom
      activeConversationId.value = conversationId
      activeRoomName.value = join.livekitRoom
      activeCallId.value = chatStore.activeCalls.find(call => call.conversationId === conversationId)?.id ?? ''

      callDebug('joining livekit room', {
        room: join.livekitRoom,
        livekitUrl: normalizedLiveKitUrl,
      })
      await withTimeout(
        nextRoom.connect(normalizedLiveKitUrl, join.livekitToken),
        JOIN_ROOM_CONNECT_TIMEOUT_MS,
        'Timed out while joining huddle',
      )

      // PCTransport.publisher accumulates one `.once('rtpVideoPayloadTypes')`
      // listener per negotiate() call (triggered by every replaceTrack and track
      // publish). The default EventEmitter limit is 10 — raise it to silence the
      // MaxListenersExceededWarning that appears during normal operation.
      try {
        const publisher = (nextRoom as unknown as {
          engine: { pcManager?: { publisher: { setMaxListeners(n: number): void } } }
        }).engine?.pcManager?.publisher
        publisher?.setMaxListeners(50)
      } catch { /* best effort */ }

      ensureRemoteTracksSubscribed(nextRoom)
      logLocalVideoPublications(nextRoom, 'after-connect')
      logRemoteVideoPublications(nextRoom, 'after-connect')
      if (canUseMediaDevices) {
        await nextRoom.startAudio()
        callDebug('startAudio resolved', {
          canPlaybackAudio: nextRoom.canPlaybackAudio,
        })
      } else {
        errorMessage.value = mediaUnavailableMessage()
      }
      playbackBlocked.value = !nextRoom.canPlaybackAudio
      connected.value = true
      remoteParticipantCount.value = nextRoom.remoteParticipants.size
      if (remoteParticipantCount.value === 0) {
        scheduleEmptyCallAutoClose()
      }
      mediaVersion.value += 1
      startRemoteAudioStatsLoop(nextRoom)
      micEnabled.value = false
      if (canUseMediaDevices) {
        try {
          await nextRoom.localParticipant.setMicrophoneEnabled(true, buildAudioCaptureOptions())
          micEnabled.value = true
          callDebug('microphone enabled', { localParticipant: nextRoom.localParticipant.identity })
          // Apply audio post-processing (RNNoise and/or software gain)
          const prefs = loadAudioPrefs()
          const pub = nextRoom.localParticipant.getTrackPublication(Track.Source.Microphone)
          const audioTrack = pub?.track as LocalAudioTrack | undefined
          if (audioTrack) {
            // Build the unified audio processing pipeline:
            //   gain (if needed) → RNNoise (if enabled) → replaceTrack
            // Gain runs before RNNoise so the noise suppressor receives a
            // well-levelled signal. See applyAudioProcessing for details.
            try {
              audioProcessingCleanup?.()
              audioProcessingCleanup = await applyAudioProcessing(audioTrack, {
                autoGainControl: prefs.autoGainControl,
                microphoneGain: prefs.microphoneGain,
                rnnoiseEnabled: prefs.rnnoiseEnabled,
              })
              callDebug('audio processing applied', {
                gain: prefs.microphoneGain,
                rnnoise: prefs.rnnoiseEnabled,
                agc: prefs.autoGainControl,
              })
            } catch (err) {
              callDebug('audio processing failed', { error: err instanceof Error ? err.message : String(err) })
            }
          }
        } catch (err) {
          errorMessage.value = err instanceof Error
            ? err.message
            : 'Failed to enable microphone.'
          callDebug('microphone enable failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      cameraEnabled.value = false
      screenShareEnabled.value = false
      callDebug('call connected summary', {
        room: nextRoom.name,
        remoteParticipantCount: nextRoom.remoteParticipants.size,
        canPlaybackAudio: nextRoom.canPlaybackAudio,
      })
    } catch (err) {
      await ensureDisconnected()
      errorMessage.value = err instanceof Error ? err.message : 'Failed to join call'
      callDebug('startOrJoinCall failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      clearPendingJoin()
      connecting.value = false
    }
  }

  async function leaveCall() {
    console.info('[call-leave] leave requested', {
      connected: connected.value,
      room: room.value?.name ?? null,
      conversationId: activeConversationId.value || null,
      activeCallId: activeCallId.value || null,
      remoteParticipantCount: remoteParticipantCount.value,
    })
    await ensureDisconnected()
  }

  async function resetRuntimeState() {
    await ensureDisconnected()
    clearPendingInviteMembers()
    clearEmptyCallAutoCloseTimer()
    stopRemoteAudioStatsLoop()

    activeConversationId.value = ''
    activeConversationKind.value = 'channel'
    activeConversationVisibility.value = 'public'
    activeCallId.value = ''
    activeRoomName.value = ''
    connecting.value = false
    connected.value = false
    minimized.value = false
    micEnabled.value = false
    cameraEnabled.value = false
    screenShareEnabled.value = false
    remoteParticipantCount.value = 0
    mediaVersion.value = 0
    activeSpeakerSids.value = new Set()
    playbackBlocked.value = false
    errorMessage.value = ''
    knownRemoteParticipantSids.clear()
    suppressParticipantChangeSounds = false
  }

  async function toggleMute() {
    const current = room.value
    if (!current) return
    const next = !micEnabled.value
    if (!hasGetUserMedia() && !micEnabled.value && next) {
      throw new Error(mediaUnavailableMessage())
    }
    // The AudioContext pipeline (RNNoise / gain) stays alive across mute/unmute.
    // setMicrophoneEnabled(false) calls _mediaStreamTrack.enabled = false which
    // silences the MediaStreamSource inside the AudioContext naturally.
    // setMicrophoneEnabled(true) re-enables the track and audio flows again.
    // Tearing down and rebuilding the pipeline on every mute/unmute would:
    //   1. Re-download rnnoise JS files and recompile the WASM worklet every time.
    //   2. Require replaceTrack() again, which has a race with LiveKit's own
    //      resumeUpstream() call, leaving the RTCRtpSender pointing at the wrong track.
    await current.localParticipant.setMicrophoneEnabled(next, next ? buildAudioCaptureOptions() : undefined)
    micEnabled.value = next
    callDebug('toggle mute', {
      enabled: next,
      room: current.name,
    })
  }

  async function toggleCamera() {
    const current = room.value
    if (!current) return
    if (!hasGetUserMedia()) {
      throw new Error(mediaUnavailableMessage())
    }
    const next = !cameraEnabled.value
    await current.localParticipant.setCameraEnabled(next)
    cameraEnabled.value = next
    callDebug('toggle camera', {
      enabled: next,
      room: current.name,
    })
  }

  async function toggleScreenShare() {
    const current = room.value
    if (!current) return
    if (!hasGetUserMedia()) {
      throw new Error(mediaUnavailableMessage())
    }
    const next = !screenShareEnabled.value
    logScreenShare('toggle requested', {
      enabled: next,
      room: current.name,
    })
    logLocalVideoPublications(current, 'before-toggle')
    if (next) {
      if (remoteScreenShareActive.value) {
        throw new Error('Another participant is already sharing their screen')
      }
      // Capture options: match fps to encoding target (avoids capturing 30 fps
      // only to drop to 15 at the encoder), and hint the encoder to preserve
      // spatial sharpness — critical for text, code, and UI content.
      const captureOptions: ScreenShareCaptureOptions = {
        // resolution.frameRate constrains getDisplayMedia capture fps to match
        // the encoding target — avoids capturing 30 fps only to discard half.
        resolution: { ...ScreenSharePresets.h1080fps15.resolution, frameRate: 15 },
        contentHint: 'detail',
      }
      // Publish options: VP9 gives ~40% better quality than VP8 at the same
      // bitrate for screen content (sharp edges, text). VP8 fallback ensures
      // compatibility with any receiver that doesn't support VP9.
      // simulcast is disabled: for text/UI a single high-quality layer is
      // preferable — the lower simulcast layer (~960×540) degrades text
      // legibility and adaptiveStream already handles receiver-side adaptation.
      const publishOptions: TrackPublishOptions = {
        videoCodec: 'vp9',
        backupCodec: { codec: 'vp8' },
        screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
        simulcast: false,
      }
      await current.localParticipant.setScreenShareEnabled(true, captureOptions, publishOptions)
    } else {
      await current.localParticipant.setScreenShareEnabled(false)
    }
    screenShareEnabled.value = next
    logLocalVideoPublications(current, 'after-toggle')
    logRemoteVideoPublications(current, 'after-toggle')
    callDebug('toggle screen share', {
      enabled: next,
      room: current.name,
    })
  }

  async function enableAudioPlayback() {
    const current = room.value
    if (!current) return
    callDebug('enableAudioPlayback requested')
    await current.startAudio()
    playbackBlocked.value = !current.canPlaybackAudio
    callDebug('enableAudioPlayback resolved', {
      canPlaybackAudio: current.canPlaybackAudio,
    })
  }

  function localVideoTrack(): LocalVideoTrack | null {
    const current = room.value
    if (!current) return null
    const pub = current.localParticipant.getTrackPublication(Track.Source.Camera)
    if (pub?.track && pub.track.kind === 'video') return pub.track as LocalVideoTrack
    return null
  }

  function localScreenShareTrack(): LocalVideoTrack | null {
    const current = room.value
    if (!current) return null
    const pub = current.localParticipant.getTrackPublication(Track.Source.ScreenShare)
    if (pub?.track && pub.track.kind === 'video') return pub.track as LocalVideoTrack
    return null
  }

  function toggleMinimized() {
    minimized.value = !minimized.value
  }

  function registerWsHandlers() {
    const ws = useWsStore()
    ws.onJoinCallTokenResponse(resp => {
      callDebug('ws joinCallTokenResponse', {
        room: resp.livekitRoom,
        livekitUrl: resp.livekitUrl,
      })
      if (pendingJoinResolve) {
        pendingJoinResolve(resp)
      }
      clearPendingJoin()
    })
    ws.onCreateCallResponse((resp) => {
      callDebug('ws createCallResponse', resp)
      // create response is used implicitly by active_call updates + join token request.
    })
    ws.onProtocolError((err) => {
      if (!pendingInviteMembersRequestId) return
      if (err.requestId !== pendingInviteMembersRequestId) return
      const message = err.code === ErrorCode.CALL_NOT_ACTIVE
        ? 'Call is no longer active'
        : (err.message || 'Failed to invite members')
      if (pendingInviteMembersReject) {
        pendingInviteMembersReject(new Error(message))
      }
      clearPendingInviteMembers()
    })
    ws.onInviteCallMembersResponse((resp, requestId) => {
      if (!pendingInviteMembersRequestId) return
      if (requestId !== pendingInviteMembersRequestId) return
      callDebug('ws inviteCallMembersResponse', resp)
      if (pendingInviteMembersResolve) {
        pendingInviteMembersResolve(resp)
      }
      clearPendingInviteMembers()
    })
    ws.onCallInviteActionAck((resp) => {
      callDebug('ws callInviteActionAck', resp)
      // call invite actions are currently handled by chat state fanout.
    })
  }

  function syncWithActiveCalls() {
    if (!activeConversationId.value) return
    const conversationKnownInSidebar = chatStore.channels.some(channel => channel.id === activeConversationId.value)
      || chatStore.directMessages.some(dm => dm.id === activeConversationId.value)
    if (!conversationKnownInSidebar) return
    const stillActive = chatStore.activeCalls.some(call => call.conversationId === activeConversationId.value)
    if (!stillActive) {
      callDebug('active call missing from chat store, leaving room', {
        conversationId: activeConversationId.value,
      })
      void leaveCall()
    }
  }

  return {
    room,
    activeConversationId,
    activeCallId,
    activeRoomName,
    activeConversationTitle,
    connecting,
    connected,
    minimized,
    micEnabled,
    cameraEnabled,
    screenShareEnabled,
    remoteScreenShareActive,
    remoteParticipantCount,
    mediaVersion,
    activeSpeakerSids,
    playbackBlocked,
    errorMessage,
    startOrJoinCall,
    inviteMembersToActiveCall,
    leaveCall,
    resetRuntimeState,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    enableAudioPlayback,
    localVideoTrack,
    localScreenShareTrack,
    toggleMinimized,
    registerWsHandlers,
    syncWithActiveCalls,
  }
})
