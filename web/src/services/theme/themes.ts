export const COLOR_THEME_IDS = ['dark', 'light', 'pink'] as const

export type ThemeId = typeof COLOR_THEME_IDS[number]

export const COLOR_THEME_TOKEN_NAMES = [
  'bgPrimary',
  'bgSecondary',
  'bgTertiary',
  'surface',
  'surfaceHover',
  'input',
  'divider',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'textOnAccent',
  'accent',
  'accentHover',
  'selectionBg',
  'selectionText',
  'selectionBorder',
  'taskIdText',
  'taskIdBg',
  'statusGreen',
  'statusRed',
  'statusAmber',
  'sidebarBg',
  'sidebarHover',
  'sidebarText',
  'sidebarTextMuted',
  'sidebarHeading',
  'sidebarUnreadBadge',
] as const

export type ColorThemeTokenName = typeof COLOR_THEME_TOKEN_NAMES[number]
export type ColorThemeTokens = Record<ColorThemeTokenName, string>

export interface ColorTheme {
  id: ThemeId
  label: string
  swatches: readonly string[]
  tokens: ColorThemeTokens
  colorScheme: 'dark' | 'light'
}

export const colorThemes: readonly ColorTheme[] = [
  {
    id: 'dark',
    label: 'Dark',
    colorScheme: 'dark',
    swatches: ['#1A1D21', '#19171D', '#1164A3', '#c99444'],
    // Keep these defaults mirrored in style.css :root to avoid a flash before JS applies the stored theme.
    tokens: {
      bgPrimary: '#1A1D21',
      bgSecondary: '#19171D',
      bgTertiary: '#222529',
      surface: '#1A1D21',
      surfaceHover: '#1E2126',
      input: '#222529',
      divider: '#2E3239',
      textPrimary: '#F8FAFC',
      textSecondary: '#CBD5E1',
      textMuted: '#94A3B8',
      textOnAccent: '#FFFFFF',
      accent: '#1164A3',
      accentHover: '#0E538C',
      selectionBg: '#1164A3',
      selectionText: '#FFFFFF',
      selectionBorder: '#3B82F6',
      taskIdText: '#c99444',
      taskIdBg: '#2A2418',
      statusGreen: '#22C55E',
      statusRed: '#EF4444',
      statusAmber: '#F59E0B',
      sidebarBg: '#19171D',
      sidebarHover: '#27242C',
      sidebarText: '#D8D3DC',
      sidebarTextMuted: '#9B8D9B',
      sidebarHeading: '#7B6C7B',
      sidebarUnreadBadge: '#ffbebe',
    },
  },
  {
    id: 'light',
    label: 'Light',
    colorScheme: 'light',
    swatches: ['#FFFFFF', '#F8FAFC', '#2563EB', '#FEF3C7'],
    tokens: {
      bgPrimary: '#FFFFFF',
      bgSecondary: '#F8FAFC',
      bgTertiary: '#F1F5F9',
      surface: '#FFFFFF',
      surfaceHover: '#F1F5F9',
      input: '#FFFFFF',
      divider: '#E2E8F0',
      textPrimary: '#0F172A',
      textSecondary: '#64748B',
      textMuted: '#94A3B8',
      textOnAccent: '#FFFFFF',
      accent: '#2563EB',
      accentHover: '#1D4ED8',
      selectionBg: '#EFF6FF',
      selectionText: '#0F172A',
      selectionBorder: '#2563EB',
      taskIdText: '#92400E',
      taskIdBg: '#FEF3C7',
      statusGreen: '#22C55E',
      statusRed: '#EF4444',
      statusAmber: '#D97706',
      sidebarBg: '#F8FAFC',
      sidebarHover: '#F1F5F9',
      sidebarText: '#334155',
      sidebarTextMuted: '#64748B',
      sidebarHeading: '#475569',
      sidebarUnreadBadge: '#FFFFFF',
    },
  },
  {
    id: 'pink',
    label: 'Pink',
    colorScheme: 'light',
    swatches: ['#FFF7FB', '#FCE7F3', '#DB2777', '#FDF2F8'],
    tokens: {
      bgPrimary: '#FFF7FB',
      bgSecondary: '#FDF2F8',
      bgTertiary: '#FCE7F3',
      surface: '#FFFFFF',
      surfaceHover: '#FCE7F3',
      input: '#FFFFFF',
      divider: '#F3C4D9',
      textPrimary: '#20111A',
      textSecondary: '#735066',
      textMuted: '#9D7189',
      textOnAccent: '#FFFFFF',
      accent: '#DB2777',
      accentHover: '#BE185D',
      selectionBg: '#FCE7F3',
      selectionText: '#20111A',
      selectionBorder: '#DB2777',
      taskIdText: '#8A3C0D',
      taskIdBg: '#FEF3C7',
      statusGreen: '#16A34A',
      statusRed: '#E11D48',
      statusAmber: '#C2410C',
      sidebarBg: '#FDF2F8',
      sidebarHover: '#FCE7F3',
      sidebarText: '#4A2438',
      sidebarTextMuted: '#87536F',
      sidebarHeading: '#A53D72',
      sidebarUnreadBadge: '#FFFFFF',
    },
  },
]

export const DEFAULT_COLOR_THEME_ID: ThemeId = 'dark'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && COLOR_THEME_IDS.includes(value as ThemeId)
}

export function getColorTheme(id: unknown): ColorTheme {
  const safeId = isThemeId(id) ? id : DEFAULT_COLOR_THEME_ID
  return colorThemes.find((theme) => theme.id === safeId) ?? colorThemes[0]
}

export function hasCompleteThemeTokens(theme: ColorTheme): boolean {
  return COLOR_THEME_TOKEN_NAMES.every((tokenName) => typeof theme.tokens[tokenName] === 'string' && theme.tokens[tokenName].trim().length > 0)
}
