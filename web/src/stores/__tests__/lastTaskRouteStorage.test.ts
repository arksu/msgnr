import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadLastOpenedTaskId,
  saveLastOpenedTaskId,
  clearLastOpenedTaskId,
} from '@/services/storage/lastTaskRouteStorage'

describe('lastTaskRouteStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores and loads last opened task id', () => {
    saveLastOpenedTaskId('task-123')
    expect(loadLastOpenedTaskId()).toBe('task-123')
  })

  it('clears last opened task id', () => {
    saveLastOpenedTaskId('task-123')
    clearLastOpenedTaskId()
    expect(loadLastOpenedTaskId()).toBe('')
  })
})
