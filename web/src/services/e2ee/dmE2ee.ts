import {
  listEncryptedDMDevices,
  registerE2EEDevice,
  type E2EEDeviceItem,
  type EncryptedDMPayloadItem,
} from '@/services/http/chatApi'

export const ENCRYPTED_DM_ALGORITHM = 'dm-p256-aesgcm-v1'

interface LocalE2EEDevice {
  deviceId: string
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
}

export interface EncryptedDMEnvelope {
  recipientDeviceId: string
  senderDeviceId: string
  algorithm: string
  sessionMessage: Uint8Array
  metadataAad: Uint8Array
}

const STORAGE_KEY = 'msgnr:e2ee:dm-device:v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function stringToBase64(value: string): string {
  return bytesToBase64(encoder.encode(value))
}

function base64ToString(value: string): string {
  return decoder.decode(base64ToBytes(value))
}

function readLocalDevice(): LocalE2EEDevice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocalE2EEDevice
    if (!parsed.deviceId || !parsed.publicKeyJwk || !parsed.privateKeyJwk) return null
    return parsed
  } catch {
    return null
  }
}

function writeLocalDevice(device: LocalE2EEDevice) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(device))
}

export function localEncryptedDMDeviceId(): string | undefined {
  return readLocalDevice()?.deviceId
}

async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey'])
}

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
}

async function deriveAesKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function createLocalDevice(): Promise<LocalE2EEDevice> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const device = {
    deviceId: crypto.randomUUID(),
    publicKeyJwk,
    privateKeyJwk,
  }
  writeLocalDevice(device)
  return device
}

export async function ensureEncryptedDMDevice(): Promise<LocalE2EEDevice> {
  const device = readLocalDevice() ?? await createLocalDevice()
  const publicKey = JSON.stringify(device.publicKeyJwk)
  await registerE2EEDevice({
    device_id: device.deviceId,
    device_label: navigator.userAgent.slice(0, 120),
    identity_key_public: stringToBase64(publicKey),
    signed_prekey_id: 1,
    signed_prekey_public: stringToBase64(publicKey),
    signed_prekey_signature: stringToBase64('webcrypto-p256-v1'),
  })
  return device
}

function publicKeyFromDevice(device: E2EEDeviceItem): JsonWebKey {
  return JSON.parse(base64ToString(device.identity_key_public)) as JsonWebKey
}

export async function encryptDMMessage(conversationId: string, clientMsgId: string, body: string): Promise<{
  senderDeviceId: string
  envelopes: EncryptedDMEnvelope[]
}> {
  const localDevice = await ensureEncryptedDMDevice()
  const recipientDevices = await listEncryptedDMDevices(conversationId)
  if (recipientDevices.length === 0) {
    throw new Error('No E2E devices are available for this conversation')
  }
  const plaintext = encoder.encode(JSON.stringify({ body }))
  const envelopes: EncryptedDMEnvelope[] = []
  for (const recipientDevice of recipientDevices) {
    const recipientPublicKey = await importPublicKey(publicKeyFromDevice(recipientDevice))
    const ephemeralPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
    const ephemeralPublicJwk = await crypto.subtle.exportKey('jwk', ephemeralPair.publicKey)
    const aesKey = await deriveAesKey(ephemeralPair.privateKey, recipientPublicKey)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const metadataAad = encoder.encode(JSON.stringify({
      conversationId,
      clientMsgId,
      senderDeviceId: localDevice.deviceId,
      recipientDeviceId: recipientDevice.device_id,
      algorithm: ENCRYPTED_DM_ALGORITHM,
    }))
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bytesToArrayBuffer(iv), additionalData: bytesToArrayBuffer(metadataAad) },
      aesKey,
      bytesToArrayBuffer(plaintext),
    ))
    const sessionMessage = encoder.encode(JSON.stringify({
      v: 1,
      epk: ephemeralPublicJwk,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(ciphertext),
    }))
    envelopes.push({
      recipientDeviceId: recipientDevice.device_id,
      senderDeviceId: localDevice.deviceId,
      algorithm: ENCRYPTED_DM_ALGORITHM,
      sessionMessage,
      metadataAad,
    })
  }
  return { senderDeviceId: localDevice.deviceId, envelopes }
}

export async function conversationHasEncryptedDMDevices(conversationId: string): Promise<boolean> {
  await ensureEncryptedDMDevice()
  const devices = await listEncryptedDMDevices(conversationId)
  return devices.length > 0
}

export async function decryptDMMessage(payloads: EncryptedDMPayloadItem[] | EncryptedDMEnvelope[] | undefined): Promise<string | null> {
  if (!payloads || payloads.length === 0) return null
  const localDevice = readLocalDevice()
  if (!localDevice) return null
  const payload = payloads.find(item => {
    const recipientDeviceId = 'recipient_device_id' in item ? item.recipient_device_id : item.recipientDeviceId
    return recipientDeviceId === localDevice.deviceId
  })
  if (!payload) return null
  const sessionMessageBytes = 'session_message' in payload
    ? base64ToBytes(payload.session_message)
    : payload.sessionMessage
  const metadataAad = 'metadata_aad' in payload
    ? base64ToBytes(payload.metadata_aad)
    : payload.metadataAad
  const sessionMessage = JSON.parse(decoder.decode(sessionMessageBytes)) as { epk: JsonWebKey; iv: string; ct: string }
  const privateKey = await importPrivateKey(localDevice.privateKeyJwk)
  const ephemeralPublicKey = await importPublicKey(sessionMessage.epk)
  const aesKey = await deriveAesKey(privateKey, ephemeralPublicKey)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(base64ToBytes(sessionMessage.iv)), additionalData: bytesToArrayBuffer(metadataAad) },
    aesKey,
    bytesToArrayBuffer(base64ToBytes(sessionMessage.ct)),
  )
  const parsed = JSON.parse(decoder.decode(new Uint8Array(decrypted))) as { body?: string }
  return parsed.body ?? ''
}
