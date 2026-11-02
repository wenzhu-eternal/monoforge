import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { roles } from './roles'

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: varchar('username', { length: 50 }).notNull(),
    email: varchar('email', { length: 100 }).notNull(),
    password: varchar('password', { length: 255 }).notNull(),
    nickname: varchar('nickname', { length: 50 }),
    avatar: varchar('avatar', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    // 微信登录: openId 唯一，password 对微信用户为占位符（不可用于登录）
    // 部分唯一索引：允许软删后用同一 openId 重新绑定
    wechatOpenId: varchar('wechat_open_id', { length: 64 }),
    roleId: integer('role_id').references(() => roles.id, { onDelete: 'set null' }),
    status: boolean('status').default(true).notNull(),
    // 首登/重置后强制改密标记，改密成功后置 false
    mustChangePassword: boolean('must_change_password').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // L28：FK 列索引（PG 不自动创建）——roles.remove 的 roleId count 与按角色筛选免全表扫
    index('idx_users_role_id').on(t.roleId),
    uniqueIndex('users_username_unique').on(t.username).where(sql`deleted_at IS NULL`),
    uniqueIndex('users_email_unique').on(t.email).where(sql`deleted_at IS NULL`),
    uniqueIndex('users_wechat_open_id_unique').on(t.wechatOpenId).where(sql`deleted_at IS NULL`),
  ],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
