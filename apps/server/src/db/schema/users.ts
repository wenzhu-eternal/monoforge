import { boolean, integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 50 }).notNull(),
  email: varchar('email', { length: 100 }).notNull(),
  password: varchar('password', { length: 255 }).notNull(),
  nickname: varchar('nickname', { length: 50 }),
  avatar: varchar('avatar', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  // 微信登录: openId 唯一，password 对微信用户为占位符（不可用于登录）
  wechatOpenId: varchar('wechat_open_id', { length: 64 }).unique(),
  roleId: integer('role_id'),
  status: boolean('status').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
