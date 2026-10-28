import { z } from 'zod'

/**
 * L15：列表分页查询入参契约（唯一来源）——controller 经 server 侧 parsePagination 桥接，
 * 取代各模块手写 Number.parseInt + NaN 400；pageSize 上限与 service 侧截断口径一致（100）
 */
export const PaginationQuerySchema = z.object({
  page: z.number().int('page 必须为正整数').min(1, 'page 必须为正整数').default(1),
  pageSize: z
    .number()
    .int('pageSize 必须为正整数')
    .min(1, 'pageSize 必须为正整数')
    .max(100, 'pageSize 不能超过 100')
    .default(10),
})

/** L15：文本型列表筛选（keyword/action/resource 等）的最大长度，超长直接 400 不进 ilike */
export const QUERY_TEXT_MAX_LENGTH = 200

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    list: z.array(itemSchema),
    // total 允许 0（空表）；totalPages 服务端统一 `|| 1`（空态至少一页，六模块 + notifications
    // 同口径），实际不会为 0——schema 保留 min(0) 仅作容差，positive() 会把 0 误报成 500
    total: z.number().int().min(0),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPages: z.number().int().min(0),
  })

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>
export type PaginatedResponse<T> = {
  list: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
