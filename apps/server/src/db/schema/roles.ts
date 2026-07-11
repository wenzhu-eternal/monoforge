import { sql } from 'drizzle-orm'
import { pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

export const roles = pgTable(
  'roles',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 50 }).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [uniqueIndex('roles_name_unique').on(t.name).where(sql`deleted_at IS NULL`)],
)

export type Role = typeof roles.$inferSelect
export type NewRole = typeof roles.$inferInsert
