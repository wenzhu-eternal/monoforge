import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const files = pgTable('files', {
  id: serial('id').primaryKey(),
  filename: varchar('filename', { length: 255 }).notNull(), // 磁盘存储名
  originalName: varchar('original_name', { length: 255 }).notNull(), // 原始文件名
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  size: integer('size').notNull(), // 字节
  path: text('path').notNull(), // 磁盘绝对路径
  uploadedBy: integer('uploaded_by').references(() => users.id), // 上传者
  createdAt: timestamp('created_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type FileRecord = typeof files.$inferSelect
export type NewFileRecord = typeof files.$inferInsert
