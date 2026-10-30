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
  // L6：先做整数串校验再转数——原 Number.parseInt 会把 '12abc' 截成 12 静默分页，
  // 与 audit userId 等"非法输入直接 400"的收口口径不一致
  const toInt = (raw: string | undefined, fallback: number, field: string): number => {
    if (!raw) return fallback
    if (!/^\d+$/.test(raw)) throw new BadRequestException(`${field} 必须为正整数`)
    return Number.parseInt(raw, 10)
  }
  const pageNum = toInt(page, 1, 'page')
  const size = toInt(pageSize, 10, 'pageSize')

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
