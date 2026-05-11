function decodeNotificationEscapeToken(token: string): string {
  switch (token) {
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    case '"':
      return '"'
    case '\'':
      return '\''
    case '/':
      return '/'
    case '\\':
      return '\\'
    default:
      return token
  }
}

export function decodeNotificationText(input: string | undefined | null): string {
  if (!input) return ''

  return input
    .replace(/\\\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\\(["\\/'])/g, (_match, token: string) => decodeNotificationEscapeToken(token))
    .replace(/\\\\([nrt])/g, (_match, token: string) => decodeNotificationEscapeToken(token))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(["\\/bfnrt'])/g, (_match, token: string) => decodeNotificationEscapeToken(token))
}
