import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { SanitizeMiddleware } from './sanitize.middleware'

function run(body: unknown): unknown {
  const middleware = new SanitizeMiddleware()
  const req = { body } as unknown as Request
  const next = vi.fn()
  middleware.use(req, {} as Response, next)
  return (req as { sanitizedBody?: unknown }).sanitizedBody
}

describe('SanitizeMiddleware', () => {
  it('M7：PII 键（phone/email/code）与密码令牌全部掩码', () => {
    const out = run({
      username: 'alice',
      password: 'p@ss',
      phone: '13800138000',
      phoneNumber: '13800138000',
      email: 'alice@example.com',
      code: '123456',
      verificationCode: '654321',
      token: 'jwt',
      nested: { email: 'n@example.com', nickname: 'nick' },
    }) as Record<string, unknown>

    expect(out.username).toBe('alice')
    expect(out.password).toBe('***REDACTED***')
    expect(out.phone).toBe('***REDACTED***')
    expect(out.phoneNumber).toBe('***REDACTED***')
    expect(out.email).toBe('***REDACTED***')
    expect(out.code).toBe('***REDACTED***')
    expect(out.verificationCode).toBe('***REDACTED***')
    expect(out.token).toBe('***REDACTED***')
    expect((out.nested as Record<string, unknown>).email).toBe('***REDACTED***')
    expect((out.nested as Record<string, unknown>).nickname).toBe('nick')
  })

  it('数组元素内的敏感键同样掩码', () => {
    const out = run([{ email: 'a@b.com' }, { name: 'x' }]) as Array<Record<string, unknown>>
    expect(out[0].email).toBe('***REDACTED***')
    expect(out[1].name).toBe('x')
  })

  it('无敏感键时原样保留（含数字与布尔值）', () => {
    const out = run({ page: 1, enabled: true, nickname: 'nick' }) as Record<string, unknown>
    expect(out).toEqual({ page: 1, enabled: true, nickname: 'nick' })
  })

  it('body 为空/非对象时静默跳过', () => {
    expect(run(undefined)).toBeUndefined()
    expect(run('string')).toBeUndefined()
  })
})
