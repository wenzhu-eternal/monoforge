import { describe, expect, it } from 'vitest'
import { normalizeIpForKey } from './ip-normalize'

describe('normalizeIpForKey（L17⑤）', () => {
  it('IPv4 保留前三段，末段折叠', () => {
    expect(normalizeIpForKey('1.2.3.4')).toBe('1.2.3.:id')
    expect(normalizeIpForKey('::ffff:1.2.3.4')).toBe('1.2.3.:id')
  })

  it('非法 IPv4（段值 >255）不再自成一桶，落 unknown', () => {
    expect(normalizeIpForKey('999.999.999.999')).toBe('unknown')
    expect(normalizeIpForKey('1.2.3.999')).toBe('unknown')
  })

  it('IPv6 保留前 4 组，其余折叠', () => {
    expect(normalizeIpForKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2:id')
  })

  it('缺失/空串落 unknown', () => {
    expect(normalizeIpForKey(undefined)).toBe('unknown')
    expect(normalizeIpForKey('  ')).toBe('unknown')
  })
})
