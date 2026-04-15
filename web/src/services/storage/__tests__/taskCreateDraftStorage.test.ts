import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSubtaskCreateDraft,
  clearTaskCreateDraft,
  loadSubtaskCreateDraft,
  loadTaskCreateDraft,
  saveSubtaskCreateDraft,
  saveTaskCreateDraft,
} from '@/services/storage/taskCreateDraftStorage'

describe('taskCreateDraftStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loads saved task draft JSON', () => {
    saveTaskCreateDraft({
      title: 'Task title',
      description: 'Task description',
    })

    expect(loadTaskCreateDraft()).toEqual({
      title: 'Task title',
      description: 'Task description',
    })
  })

  it('returns an empty task draft on malformed JSON', () => {
    localStorage.setItem('msgnr:tasks:create-draft:v1', '{bad json')

    expect(loadTaskCreateDraft()).toEqual({
      title: '',
      description: '',
    })
  })

  it('clears stored task draft explicitly', () => {
    saveTaskCreateDraft({
      title: 'Task title',
      description: 'Task description',
    })

    clearTaskCreateDraft()

    expect(loadTaskCreateDraft()).toEqual({
      title: '',
      description: '',
    })
  })

  it('removes the task draft when both fields are blank', () => {
    saveTaskCreateDraft({
      title: '   ',
      description: '',
    })

    expect(localStorage.getItem('msgnr:tasks:create-draft:v1')).toBeNull()
    expect(loadTaskCreateDraft()).toEqual({
      title: '',
      description: '',
    })
  })

  it('saves and clears the subtask draft independently', () => {
    saveSubtaskCreateDraft({
      title: 'Subtask title',
      description: 'Subtask description',
    })

    expect(loadSubtaskCreateDraft()).toEqual({
      title: 'Subtask title',
      description: 'Subtask description',
    })

    clearSubtaskCreateDraft()

    expect(loadSubtaskCreateDraft()).toEqual({
      title: '',
      description: '',
    })
  })
})
