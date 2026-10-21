import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { errorLogs } from './schema/error-logs'
import { notifications } from './schema/notifications'

// L10：清理任务按 created_at 全量截断，索引必须以 created_at 为首列，否则每批 ctid 子查询退化为全表扫描
describe('保留期清理索引（L10）', () => {
  it.each([
    ['notifications', notifications, 'idx_notifications_created_at'],
    ['error_logs', errorLogs, 'idx_error_logs_created_at'],
  ] as const)('%s 有 created_at 单列索引', (_table, table, indexName) => {
    const indexes = getTableConfig(table).indexes
    const target = indexes.find((item) => item.config.name === indexName)

    expect(target).toBeDefined()
    expect(target?.config.columns.map((column) => column.name)).toEqual(['created_at'])
  })
})
