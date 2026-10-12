import { describe, expect, it } from 'vitest'
import {
  CreateErrorWhitelistSchema,
  ErrorWhitelistSchema,
  UpdateErrorWhitelistSchema,
} from './error-log'

describe('CreateErrorWhitelistSchema（L7 pattern ≥4）', () => {
  it('3 字符模式失败（复现：旧 min(1) 放行过短模式会静默吞掉同类报错）', () => {
    expect(
      CreateErrorWhitelistSchema.safeParse({ pattern: 'E1', matchType: 'message' }).success,
    ).toBe(false)
    expect(CreateErrorWhitelistSchema.safeParse({ pattern: 'ab' }).success).toBe(false)
  })

  it('4 字符模式通过', () => {
    expect(CreateErrorWhitelistSchema.safeParse({ pattern: 'ECONN' }).success).toBe(true)
  })

  it('matchType 缺省走默认 message', () => {
    const result = CreateErrorWhitelistSchema.safeParse({ pattern: '/api' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.matchType).toBe('message')
  })

  it('超过 500 字符失败', () => {
    expect(CreateErrorWhitelistSchema.safeParse({ pattern: 'a'.repeat(501) }).success).toBe(false)
  })
})

describe('UpdateErrorWhitelistSchema（L7 PATCH 同样限 ≥4）', () => {
  it('不改 pattern 可通过（可选字段）', () => {
    expect(UpdateErrorWhitelistSchema.safeParse({ isActive: false }).success).toBe(true)
  })

  it('把 pattern 改短于 4 失败（堵创建侧绕过）', () => {
    expect(UpdateErrorWhitelistSchema.safeParse({ pattern: 'x' }).success).toBe(false)
  })

  it('改成长模式通过', () => {
    expect(UpdateErrorWhitelistSchema.safeParse({ pattern: 'ETIMEDOUT' }).success).toBe(true)
  })
})

describe('ErrorWhitelistSchema（回显不加严）', () => {
  const baseRow = {
    id: 1,
    matchType: 'message',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  it('存量 1 字符规则照常回显（不因写入侧加严而 500）', () => {
    expect(ErrorWhitelistSchema.safeParse({ ...baseRow, pattern: 'x' }).success).toBe(true)
  })

  it('常规规则回显通过', () => {
    expect(ErrorWhitelistSchema.safeParse({ ...baseRow, pattern: 'ECONNRESET' }).success).toBe(true)
  })
})
