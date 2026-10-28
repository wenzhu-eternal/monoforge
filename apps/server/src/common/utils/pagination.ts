import { BadRequestException } from '@nestjs/common'
import { PaginationQuerySchema, QUERY_TEXT_MAX_LENGTH } from '@shared/schemas'

/**
 * L15：分页查询统一桥接——contract 在 @shared（PaginationQuerySchema），
 * 这里只负责 query string → number 与 400 文案，取代各 controller 手写三行解析 + 两条 NaN 断言
 */
export function parsePagination(
  page?: string,
  pageSize?: string,
): { page: number; pageSize: number } {
  const pageNum = page ? Number.parseInt(page, 10) : 1
  const size = pageSize ? Number.parseInt(pageSize, 10) : 10
  // NaN 走显式文案（zod 的 invalid_type 提示对终端用户不可读）
  if (Number.isNaN(pageNum)) throw new BadRequestException('page 必须为正整数')
  if (Number.isNaN(size)) throw new BadRequestException('pageSize 必须为正整数')

  const parsed = PaginationQuerySchema.safeParse({ page: pageNum, pageSize: size })
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues[0]?.message ?? '分页参数非法')
  }
  return parsed.data
}

/**
 * L15：文本型筛选参数长度上限——超长直接 400，避免任意长字符串进入 ilike（已参数化，此为防御性收敛）
 */
export function parseQueryText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined
  if (value.length > QUERY_TEXT_MAX_LENGTH) {
    throw new BadRequestException(`${field} 不能超过 ${QUERY_TEXT_MAX_LENGTH} 个字符`)
  }
  return value
}
