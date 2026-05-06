export function hexToRgbTriplet(hex: string): string {
  const normalized = hex.trim().replace(/^#/, '')
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized
  const intValue = Number.parseInt(value, 16)
  if (!Number.isFinite(intValue)) return '0 0 0'
  return [
    (intValue >> 16) & 255,
    (intValue >> 8) & 255,
    intValue & 255,
  ].join(' ')
}
