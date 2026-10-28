import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PaginatedResponseSchema, PaginationQuerySchema } from './pagination'

describe('PaginationQuerySchema（L15 分页入参契约）', () => {
  it('缺省时回落到 page=1/pageSize=10', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 })
  })

  it('page<1 / pageSize<1 / 非整数 均失败，且文案可直接透给用户', () => {
    const page = PaginationQuerySchema.safeParse({ page: 0 })
    expect(page.success).toBe(false)
    expect(page.error?.issues[0]?.message).toBe('page 必须为正整数')

    const size = PaginationQuerySchema.safeParse({ pageSize: 0 })
    expect(size.success).toBe(false)
    expect(size.error?.issues[0]?.message).toBe('pageSize 必须为正整数')

    expect(PaginationQuerySchema.safeParse({ page: 1.5 }).success).toBe(false)
  })

  it('pageSize 上限 100（与 service 侧截断口径一致）', () => {
    expect(PaginationQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true)
    expect(PaginationQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
  })
})

describe('PaginatedResponseSchema', () => {
  const ItemSchema = z.object({ id: z.number() })
  const Schema = PaginatedResponseSchema(ItemSchema)

  it('合法数据通过', () => {
    expect(
      Schema.safeParse({
        list: [{ id: 1 }, { id: 2 }],
        total: 2,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }).success,
    ).toBe(true)
  })

  it('list 字段名错误失败（不能用 items）', () => {
    expect(
      Schema.safeParse({
        items: [{ id: 1 }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }).success,
    ).toBe(false)
  })

  it('空表时 total 为 0 通过（min(0) 允许空表场景）', () => {
    expect(
      Schema.safeParse({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      }).success,
    ).toBe(true)
  })

  it('total 负数失败', () => {
    expect(
      Schema.safeParse({
        list: [],
        total: -1,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      }).success,
    ).toBe(false)
  })
})
