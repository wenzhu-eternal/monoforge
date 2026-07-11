import { sql } from 'drizzle-orm'
import { json, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

export const permissions = pgTable(
  'permissions',
  {
    id: serial('id').primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    routes: json('routes').$type<string[]>().default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [uniqueIndex('permissions_code_unique').on(t.code).where(sql`deleted_at IS NULL`)],
)

export type Permission = typeof permissions.$inferSelect
export type NewPermission = typeof permissions.$inferInsert
