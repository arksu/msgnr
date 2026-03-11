import { storage } from '@/services/storage/storageAdapter'

const LAST_TASK_ID_KEY = 'msgnr:last-task-id:global:v1'

export function loadLastOpenedTaskId(): string {
  return storage.getItem(LAST_TASK_ID_KEY) ?? ''
}

export function saveLastOpenedTaskId(taskId: string) {
  if (!taskId) return
  storage.setItem(LAST_TASK_ID_KEY, taskId)
}

export function clearLastOpenedTaskId() {
  storage.removeItem(LAST_TASK_ID_KEY)
}
