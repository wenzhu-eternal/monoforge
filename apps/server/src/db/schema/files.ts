import { index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const files = pgTable(
  'files',
  {
    id: serial('id').primaryKey(),
    filename: varchar('filename', { length: 255 }).notNull(), // 磁盘存储名
    originalName: varchar('original_name', { length: 255 }).notNull(), // 原始文件名
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: integer('size').notNull(), // 字节
    path: text('path').notNull(), // 磁盘绝对路径
    uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }), // 上传者
    trashPath: varchar('trash_path', { length: 255 }), // 软删时隔离文件路径
    createdAt: timestamp('created_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    index('idx_files_uploaded_by').on(t.uploadedBy),
    index('idx_files_deleted_at_created_at').on(t.deletedAt, t.createdAt),
  ],
)

export type FileRecord = typeof files.$inferSelect
export type NewFileRecord = typeof files.$inferInsert
