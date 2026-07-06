import { and, type Column, isNull, type SQL } from 'drizzle-orm'

/**
 * 软删除过滤条件: deleted_at IS NULL
 */
export function notDeleted(...columns: Column[]): SQL {
  return and(...columns.map((col) => isNull(col)))!
}
