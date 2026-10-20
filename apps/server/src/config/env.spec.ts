import { describe, expect, it } from 'vitest'
import { isValidTrustProxyValue } from './env'

describe('TRUST_PROXY 校验（M3）', () => {
  it.each([
    'true',
    'false',
    '1',
    '2',
    'loopback',
    'linklocal',
    'uniquelocal',
    '127.0.0.1',
    '10.0.0.0/8',
    '::1',
    '2001:db8::/32',
    '1,127.0.0.1',
  ])('合法值: %s', (value) => {
    expect(isValidTrustProxyValue(value)).toBe(true)
  })

  it.each([
    'abc',
    '0',
    '-1',
    '1.2.3.999',
    '10.0.0.0/33',
    '::1/129',
    'true,abc',
    '',
  ])('非法值: %s', (value) => {
    expect(isValidTrustProxyValue(value)).toBe(false)
  })
})
