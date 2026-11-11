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

describe('normalizeIpForKey（P2-02 IPv6 等价写法归一）', () => {
  it('压缩写法与完整写法落同一桶', () => {
    const full = normalizeIpForKey('2001:0db8:0001:0002:0000:0000:0000:0001')
    const compressed = normalizeIpForKey('2001:db8:1:2::1')
    expect(full).toBe(compressed)
    expect(full).toBe('2001:db8:1:2:id')
  })

  it('同一 /64 内不同主机地址落同一桶', () => {
    expect(normalizeIpForKey('2001:db8:1:2::1')).toBe(normalizeIpForKey('2001:db8:1:2:ffff:1:2:3'))
  })

  it('不同 /64 可区分', () => {
    expect(normalizeIpForKey('2001:db8:1:2::1')).not.toBe(normalizeIpForKey('2001:db8:1:3::1'))
  })

  it('大小写等价', () => {
    expect(normalizeIpForKey('2001:DB8:1:2::A')).toBe(normalizeIpForKey('2001:db8:1:2::a'))
  })

  it('IPv4 映射地址的不同写法归同一 IPv4 桶', () => {
    expect(normalizeIpForKey('::FFFF:1.2.3.4')).toBe('1.2.3.:id')
    expect(normalizeIpForKey('0:0:0:0:0:ffff:1.2.3.4')).toBe('1.2.3.:id')
    expect(normalizeIpForKey('::ffff:102:304')).toBe('1.2.3.:id')
  })

  it('非法 IPv6 落 unknown', () => {
    expect(normalizeIpForKey('2001:db8::1::2')).toBe('unknown')
    expect(normalizeIpForKey('gggg::1')).toBe('unknown')
    expect(normalizeIpForKey('2001:db8:1:2:3:4:5')).toBe('unknown')
  })

  it('带 zone id 的链路本地地址可归一', () => {
    expect(normalizeIpForKey('fe80::1%en0')).toBe(normalizeIpForKey('fe80::1'))
  })
})
