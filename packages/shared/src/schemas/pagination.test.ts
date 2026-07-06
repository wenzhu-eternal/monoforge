import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PaginatedResponseSchema, PaginationQuerySchema } from './pagination'

describe('PaginationQuerySchema', () => {
  it('空对象时使用默认值', () => {
    const r = PaginationQuerySchema.parse({})
    expect(r.page).toBe(1)
    expect(r.pageSize).toBe(10)
    expect(r.order).toBe('desc')
  })

  it('合法参数覆盖默认值', () => {
    const r = PaginationQuerySchema.parse({ page: 2, pageSize: 20, order: 'asc' })
    expect(r.page).toBe(2)
    expect(r.pageSize).toBe(20)
    expect(r.order).toBe('asc')
  })

  it('page 非正整数失败', () => {
    expect(PaginationQuerySchema.safeParse({ page: 0 }).success).toBe(false)
    expect(PaginationQuerySchema.safeParse({ page: -1 }).success).toBe(false)
    expect(PaginationQuerySchema.safeParse({ page: 1.5 }).success).toBe(false)
  })

  it('pageSize 超过 100 失败', () => {
    expect(PaginationQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
  })

  it('order 非法值失败', () => {
    expect(PaginationQuerySchema.safeParse({ order: 'random' }).success).toBe(false)
  })

  it('sort 可选', () => {
    expect(PaginationQuerySchema.safeParse({ sort: 'createdAt' }).success).toBe(true)
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

  it('total 非正整数失败', () => {
    expect(
      Schema.safeParse({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }).success,
    ).toBe(false)
  })
})
