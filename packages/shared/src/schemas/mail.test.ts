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
  it('合法数据通过（仅 to）', () => {
    expect(SendVerificationCodeMailSchema.safeParse({ to: 'user@example.com' }).success).toBe(true)
  })

  it('带 name 通过', () => {
    expect(
      SendVerificationCodeMailSchema.safeParse({
        to: 'user@example.com',
        name: 'Alice',
      }).success,
    ).toBe(true)
  })

  it('邮箱非法失败', () => {
    expect(SendVerificationCodeMailSchema.safeParse({ to: 'nope' }).success).toBe(false)
  })

  it('name 超过 50 字符失败', () => {
    expect(
      SendVerificationCodeMailSchema.safeParse({
        to: 'user@example.com',
        name: 'a'.repeat(51),
      }).success,
    ).toBe(false)
  })
})
