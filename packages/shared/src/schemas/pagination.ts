import { z } from 'zod'

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    list: z.array(itemSchema),
    // total/totalPages 允许 0：空表时返回 0，positive() 会误报 500
    total: z.number().int().min(0),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPages: z.number().int().min(0),
  })

export type PaginationQuery = {
  page: number
  pageSize: number
  sort?: string
  order?: 'asc' | 'desc'
}
export type PaginatedResponse<T> = {
  list: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
