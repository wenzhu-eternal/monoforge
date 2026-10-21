import { describe, expect, it } from 'vitest'
import { NotifySchema } from './notification'

const base = { userId: 1, type: 'test', title: 'hello' }

describe('NotifySchema', () => {
  it('合法数据通过', () => {
    expect(NotifySchema.safeParse(base).success).toBe(true)
  })

  it('content 可选', () => {
    expect(NotifySchema.safeParse({ ...base, content: undefined }).success).toBe(true)
    expect(NotifySchema.safeParse({ ...base, content: '' }).success).toBe(true)
  })

  it('userId 必须为正整数', () => {
    expect(NotifySchema.safeParse({ ...base, userId: 0 }).success).toBe(false)
    expect(NotifySchema.safeParse({ ...base, userId: 1.5 }).success).toBe(false)
  })

  it('title 为空或超过 200 字符失败', () => {
    expect(NotifySchema.safeParse({ ...base, title: '' }).success).toBe(false)
    expect(NotifySchema.safeParse({ ...base, title: 'a'.repeat(201) }).success).toBe(false)
  })

  it('content 超过 2000 字符失败', () => {
    expect(NotifySchema.safeParse({ ...base, content: 'a'.repeat(2001) }).success).toBe(false)
  })
})
