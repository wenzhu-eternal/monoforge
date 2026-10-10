import { z } from 'zod'

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

export type PaginationQuery = {
  page: number
  pageSize: number
  // L26：后端列表固定倒序（sort/order 从未生效），契约删除两字段防误导，前端不再发送
}
export type PaginatedResponse<T> = {
  list: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
