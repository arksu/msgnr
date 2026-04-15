import { storage } from '@/services/storage/storageAdapter'

type TaskCreateDraft = {
  title: string
  description: string
}

const EMPTY_DRAFT: TaskCreateDraft = {
  title: '',
  description: '',
}

const TASK_CREATE_DRAFT_KEY = 'msgnr:tasks:create-draft:v1'
const SUBTASK_CREATE_DRAFT_KEY = 'msgnr:tasks:subtask-create-draft:v1'

function loadDraft(key: string): TaskCreateDraft {
  const raw = storage.getItem(key)
  if (!raw) return EMPTY_DRAFT
  try {
    const parsed = JSON.parse(raw) as Partial<TaskCreateDraft>
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
    }
  } catch {
    return EMPTY_DRAFT
  }
}

function saveDraft(key: string, draft: TaskCreateDraft) {
  if (draft.title.trim() === '' && draft.description.trim() === '') {
    storage.removeItem(key)
    return
  }
  storage.setItem(key, JSON.stringify(draft))
}

function clearDraft(key: string) {
  storage.removeItem(key)
}

export function loadTaskCreateDraft(): TaskCreateDraft {
  return loadDraft(TASK_CREATE_DRAFT_KEY)
}

export function saveTaskCreateDraft(draft: TaskCreateDraft) {
  saveDraft(TASK_CREATE_DRAFT_KEY, draft)
}

export function clearTaskCreateDraft() {
  clearDraft(TASK_CREATE_DRAFT_KEY)
}

export function loadSubtaskCreateDraft(): TaskCreateDraft {
  return loadDraft(SUBTASK_CREATE_DRAFT_KEY)
}

export function saveSubtaskCreateDraft(draft: TaskCreateDraft) {
  saveDraft(SUBTASK_CREATE_DRAFT_KEY, draft)
}

export function clearSubtaskCreateDraft() {
  clearDraft(SUBTASK_CREATE_DRAFT_KEY)
}
