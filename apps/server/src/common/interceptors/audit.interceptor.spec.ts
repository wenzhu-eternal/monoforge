import { describe, expect, it } from 'vitest'
import { sanitizeNewValue } from './audit.interceptor'

const MASKED = '***MASKED***'

describe('sanitizeNewValue 响应脱敏（H2/N4）', () => {
  it('N4 复现：登录响应 user 嵌套对象中的 email/phone 与顶层 accessToken 均被掩码', () => {
    const result = sanitizeNewValue(
      {
        accessToken: 'jwt-token',
        user: { id: 1, username: 'alice', email: 'a@x.com', phone: '13800138000' },
      },
      'AuthController',
    ) as Record<string, unknown>

    expect(result.accessToken).toBe(MASKED)
    const user = result.user as Record<string, unknown>
    expect(user.email).toBe(MASKED)
    expect(user.phone).toBe(MASKED)
    expect(user.username).toBe('alice')
  })

  it('深层嵌套与数组元素中的敏感字段同样掩码', () => {
    const result = sanitizeNewValue(
      {
        data: { profile: { wechatOpenId: 'wx-123' } },
        list: [{ email: 'b@x.com' }, { id: 2 }],
      },
      'AuthController',
    ) as Record<string, unknown>

    const data = result.data as Record<string, unknown>
    const profile = data.profile as Record<string, unknown>
    expect(profile.wechatOpenId).toBe(MASKED)
    const list = result.list as Array<Record<string, unknown>>
    expect(list[0]?.email).toBe(MASKED)
    expect(list[1]?.id).toBe(2)
  })

  it('UsersController 表级规则（password 等）在任意层级生效', () => {
    const result = sanitizeNewValue(
      { password: 'plain', email: 'c@x.com', nickname: 'ok' },
      'UsersController',
    ) as Record<string, unknown>

    expect(result.password).toBe(MASKED)
    expect(result.email).toBe(MASKED)
    expect(result.nickname).toBe('ok')
  })

  it('非敏感字段与原始结构原样保留', () => {
    const input = { id: 3, total: 10, flag: true, nested: { keep: 'v' } }
    expect(sanitizeNewValue(input, 'AuthController')).toEqual(input)
  })

  it('超过深度上限的原样返回（防御循环引用），浅层仍正常掩码', () => {
    const deep = { l6: { email: 'd@x.com' } } as Record<string, unknown>
    let cursor: Record<string, unknown> = deep
    for (let i = 0; i < 8; i++) {
      cursor.next = {}
      cursor = cursor.next as Record<string, unknown>
    }
    const result = sanitizeNewValue(deep, 'AuthController') as Record<string, unknown>
    // 第一层仍在扫描范围内，deep.email 命中掩码不受深对象影响
    const l6 = result.l6 as Record<string, unknown>
    expect(l6.email).toBe(MASKED)
  })

  it('循环引用对象不栈溢出（深度上限止损），浅层敏感字段仍掩码', () => {
    const cyclic: Record<string, unknown> = { email: 'e@x.com', username: 'eve' }
    cyclic.self = cyclic
    // scrub 依赖深度上限在 5 层内停止递归，绝不能 RangeError: Maximum call stack
    const result = sanitizeNewValue(cyclic, 'AuthController') as Record<string, unknown>
    expect(result.email).toBe(MASKED)
    expect(result.username).toBe('eve')
    const level2 = result.self as Record<string, unknown>
    expect(level2.email).toBe(MASKED)
  })

  it('null/undefined 与非对象输入原样返回', () => {
    expect(sanitizeNewValue(undefined, 'AuthController')).toBeUndefined()
    expect(sanitizeNewValue(null, 'AuthController')).toBeNull()
  })
})
