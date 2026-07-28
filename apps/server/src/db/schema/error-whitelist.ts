import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

export const errorWhitelist = pgTable(
  'error_whitelist',
  {
    id: serial('id').primaryKey(),
    pattern: text('pattern').notNull(),
    matchType: varchar('match_type', { length: 20 }).default('message').notNull(), // message | url
    description: text('description'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    index('idx_error_whitelist_is_active').on(t.isActive).where(sql`is_active = true`),
    uniqueIndex('idx_error_whitelist_pattern_unique')
      .on(t.matchType, t.pattern)
      .where(sql`deleted_at IS NULL`),
  ],
)

export type ErrorWhitelistItem = typeof errorWhitelist.$inferSelect
export type NewErrorWhitelistItem = typeof errorWhitelist.$inferInsert
