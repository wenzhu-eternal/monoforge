import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const errorLogs = pgTable(
  'error_logs',
  {
    id: serial('id').primaryKey(),
    source: varchar('source', { length: 20 }).default('backend').notNull(),
    errorType: varchar('error_type', { length: 50 }),
    message: text('message').notNull(),
    stack: text('stack'),
    file: varchar('file', { length: 500 }),
    line: integer('line'),
    column: integer('column'),
    url: varchar('url', { length: 500 }),
    method: varchar('method', { length: 10 }),
    statusCode: integer('status_code'),
    context: jsonb('context'),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    isResolved: boolean('is_resolved').default(false).notNull(),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    index('idx_error_logs_resolved_created').on(t.isResolved, t.createdAt),
    index('idx_error_logs_user_created').on(t.userId, t.createdAt),
    index('idx_error_logs_source_created').on(t.source, t.createdAt),
  ],
)

export type ErrorLog = typeof errorLogs.$inferSelect
export type NewErrorLog = typeof errorLogs.$inferInsert
