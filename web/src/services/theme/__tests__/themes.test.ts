import { describe, expect, it } from 'vitest'
import {
  COLOR_THEME_TOKEN_NAMES,
  colorThemes,
  getColorTheme,
  hasCompleteThemeTokens,
} from '@/services/theme/themes'

describe('themes', () => {
  it('ships complete token sets for every theme', () => {
    expect(colorThemes.map((theme) => theme.id)).toEqual(['dark', 'light', 'pink', 'rose'])
    for (const theme of colorThemes) {
      expect(hasCompleteThemeTokens(theme)).toBe(true)
      expect(Object.keys(theme.tokens).sort()).toEqual([...COLOR_THEME_TOKEN_NAMES].sort())
    }
  })

  it('falls back to dark for unknown ids', () => {
    expect(getColorTheme('unknown').id).toBe('dark')
  })
})
