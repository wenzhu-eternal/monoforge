import { z } from 'zod'

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
