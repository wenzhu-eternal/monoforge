import { z } from 'zod'

/**
 * L20：读侧契约是 DB 列的有损投影（剔除了磁盘路径等敏感列），勿据此反推 DDL——
 * `uploadedByUsername` 为 join users 派生的展示字段（非 files 列）；该 leftJoin 不过滤
 * users.deletedAt，上传者软删后用户名仍照常回显
 */
export const FileItemSchema = z.object({
  id: z.number().int().positive(),
  filename: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedBy: z.number().int().positive().nullable().optional(),
  uploadedByUsername: z.string().nullable().optional(),
  deletedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
})

export const UploadResultSchema = z.object({
  id: z.number().int().positive(),
  filename: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
})

export type FileItem = z.infer<typeof FileItemSchema>
export type UploadResult = z.infer<typeof UploadResultSchema>
