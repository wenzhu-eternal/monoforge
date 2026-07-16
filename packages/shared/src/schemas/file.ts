import { z } from 'zod'

export const FileRecordSchema = z.object({
  id: z.number().int().positive(),
  filename: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  path: z.string(),
  uploadedBy: z.number().int().positive().nullable().optional(),
  createdAt: z.coerce.date(),
})

export const FileItemSchema = z.object({
  id: z.number().int().positive(),
  filename: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedBy: z.number().int().positive().nullable().optional(),
  uploadedByUsername: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
})

export const UploadResultSchema = z.object({
  id: z.number().int().positive(),
  filename: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
})

export type FileRecord = z.infer<typeof FileRecordSchema>
export type FileItem = z.infer<typeof FileItemSchema>
export type UploadResult = z.infer<typeof UploadResultSchema>
