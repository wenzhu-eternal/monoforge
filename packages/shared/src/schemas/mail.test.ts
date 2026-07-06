import { describe, expect, it } from 'vitest'
import { SendVerificationCodeMailSchema, SendWelcomeMailSchema } from './mail'

describe('SendWelcomeMailSchema', () => {
  it('合法数据通过', () => {
    expect(
      SendWelcomeMailSchema.safeParse({ to: 'user@example.com', username: 'alice' }).success,
    ).toBe(true)
  })

  it('邮箱格式非法失败', () => {
    expect(SendWelcomeMailSchema.safeParse({ to: 'not-email', username: 'alice' }).success).toBe(
      false,
    )
  })

  it('username 为空失败', () => {
    expect(SendWelcomeMailSchema.safeParse({ to: 'user@example.com', username: '' }).success).toBe(
      false,
    )
  })

  it('username 超过 50 字符失败', () => {
    expect(
      SendWelcomeMailSchema.safeParse({
        to: 'user@example.com',
        username: 'a'.repeat(51),
      }).success,
    ).toBe(false)
  })
})

describe('SendVerificationCodeMailSchema', () => {
  it('合法数据通过', () => {
    expect(
      SendVerificationCodeMailSchema.safeParse({ to: 'user@example.com', code: '123456' }).success,
    ).toBe(true)
  })

  it('带 name 通过', () => {
    expect(
      SendVerificationCodeMailSchema.safeParse({
        to: 'user@example.com',
        code: '123456',
        name: 'Alice',
      }).success,
    ).toBe(true)
  })

  it('code 短于 4 位失败', () => {
    expect(
      SendVerificationCodeMailSchema.safeParse({ to: 'user@example.com', code: '123' }).success,
    ).toBe(false)
  })

  it('code 长于 8 位失败', () => {
    expect(
      SendVerificationCodeMailSchema.safeParse({ to: 'user@example.com', code: '123456789' })
        .success,
    ).toBe(false)
  })

  it('code 包含非数字失败', () => {
    expect(
      SendVerificationCodeMailSchema.safeParse({ to: 'user@example.com', code: 'abcdef' }).success,
    ).toBe(false)
  })

  it('邮箱非法失败', () => {
    expect(SendVerificationCodeMailSchema.safeParse({ to: 'nope', code: '123456' }).success).toBe(
      false,
    )
  })
})
