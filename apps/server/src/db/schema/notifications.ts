import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content'),
    read: boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('idx_notifications_user_read_created').on(
      table.userId,
      table.read,
      table.createdAt,
    ),
    // L2：保留期清理实际锚点为 coalesce(deleted_at, created_at)（软删名实相符），
    // 普通 created_at 索引无法命中该表达式，清理批次退化为 seq scan——量级低且只在 0:30
    // 低峰执行，接受该取舍；若日后通知量级显著上升，再补 coalesce 表达式索引
    createdAtIdx: index('idx_notifications_created_at').on(table.createdAt),
  }),
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
