import { and, type Column, isNull, type SQL } from 'drizzle-orm'

/**
 * 软删除过滤条件: deleted_at IS NULL
 */
export function notDeleted(...columns: Column[]): SQL {
  return and(...columns.map((col) => isNull(col)))!
}

/**
 * 判断是否为 PostgreSQL 唯一约束违反错误（错误码 23505）
 * 用于 TOCTOU 兜底：并发场景下唯一约束冲突转 409
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  )
}
