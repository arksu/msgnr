import { describe, expect, it } from 'vitest'

import { decodeNotificationText } from '@/services/notificationText'

describe('decodeNotificationText', () => {
  it('decodes JSON-style notification escapes into plain text', () => {
    expect(decodeNotificationText('Mention \\/ \\"Boss\\" \\u263A')).toBe('Mention / "Boss" \u263A')
    expect(decodeNotificationText('Line 1\\\\nLine 2\\/done\\\\folder')).toBe('Line 1\nLine 2/done\\folder')
  })
})
