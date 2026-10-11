import { describe, expect, it } from 'vitest'
import { safeAuthRedirect } from '../lib/auth-redirect'

describe('authentication return paths', () => {
  it('preserves an internal destination and its query and fragment', () => {
    expect(safeAuthRedirect('/app/intents?state=validated#latest')).toBe('/app/intents?state=validated#latest')
  })

  it.each([undefined, ['//example.com'], 'https://example.com', '//example.com', '/\\example.com', '/\n/example.com', 'javascript:alert(1)'])('rejects unsafe return paths: %s', (value) => {
    expect(safeAuthRedirect(value)).toBe('/app')
  })
})
