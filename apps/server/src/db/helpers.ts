import { type Column, isNull, type SQL } from 'drizzle-orm'

/**
 * 软删除过滤条件: deleted_at IS NULL
 */
export function notDeleted(column: Column): SQL {
  return isNull(column)
}

/**
 * 条件软删过滤: includeDeleted 为 true 时返回 undefined（不加 where），否则返回 notDeleted
 * 管理员查询传 true，普通用户传 false
 */
export function maybeDeleted(column: Column, includeDeleted: boolean): SQL | undefined {
  return includeDeleted ? undefined : notDeleted(column)
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
