import { describe, expect, it } from 'vitest'
import { hexToRgbTriplet } from '@/utils/color'

describe('color utilities', () => {
  it('converts six-digit and shorthand hex colors to rgb triplets', () => {
    expect(hexToRgbTriplet('#2563EB')).toBe('37 99 235')
    expect(hexToRgbTriplet('#fff')).toBe('255 255 255')
  })

  it('returns a stable fallback for invalid colors', () => {
    expect(hexToRgbTriplet('nope')).toBe('0 0 0')
  })
})
