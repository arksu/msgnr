import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRefreshToken,
  setRefreshToken,
  clearRefreshToken,
} from '@/services/storage/tokenStorage'

describe('tokenStorage', () => {
  beforeEach(() => clearRefreshToken())

  it('returns null when nothing stored', () => {
    expect(getRefreshToken()).toBeNull()
  })

  it('stores and retrieves a token', () => {
    setRefreshToken('my-token')
    expect(getRefreshToken()).toBe('my-token')
  })

  it('clears the token', () => {
    setRefreshToken('my-token')
    clearRefreshToken()
    expect(getRefreshToken()).toBeNull()
  })

  it('overwrites with latest token', () => {
    setRefreshToken('old-token')
    setRefreshToken('new-token')
    expect(getRefreshToken()).toBe('new-token')
  })
})
