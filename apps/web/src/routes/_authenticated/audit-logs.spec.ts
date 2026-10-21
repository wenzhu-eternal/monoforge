import { describe, expect, it } from 'vitest'
import { parseUserAgent } from './audit-logs'

// L3：iOS Safari UA 恒含 "like Mac OS X"，Mac 判定必须先让位于 iPhone/iPad
describe('audit-logs UA 判定（L3）', () => {
  it('iPhone Safari 判为 iOS，而非 macOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Safari', os: 'iOS' })
  })

  it('iPad Safari 判为 iOS，而非 macOS', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Safari', os: 'iOS' })
  })

  it('Mac Safari 仍判为 macOS（控制组）', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Safari', os: 'macOS' })
  })
})
