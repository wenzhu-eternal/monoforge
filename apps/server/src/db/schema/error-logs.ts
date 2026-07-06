import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

export const errorLogs = pgTable('error_logs', {
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
  userId: serial('user_id'),
  ip: varchar('ip', { length: 45 }),
  userAgent: text('user_agent'),
  isResolved: boolean('is_resolved').default(false).notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: integer('resolved_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type ErrorLog = typeof errorLogs.$inferSelect
export type NewErrorLog = typeof errorLogs.$inferInsert
