import { storage } from '@/services/storage/storageAdapter'

const LAST_APPLIED_EVENT_SEQ_KEY = 'msgnr:last-applied-event-seq'

export function loadLastAppliedEventSeq(): bigint {
  const raw = storage.getItem(LAST_APPLIED_EVENT_SEQ_KEY)
  if (!raw) return 0n
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}

export function saveLastAppliedEventSeq(value: bigint) {
  storage.setItem(LAST_APPLIED_EVENT_SEQ_KEY, value.toString())
}

export function clearLastAppliedEventSeq() {
  storage.removeItem(LAST_APPLIED_EVENT_SEQ_KEY)
}
