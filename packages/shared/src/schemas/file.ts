import { z } from 'zod'

/**
 * L20：读侧契约是 DB 列的超集，勿据此反推 DDL——
 * `uploadedByUsername` 为 join users 派生的展示字段（非 files 列，软删用户 join 不到时为空）
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
