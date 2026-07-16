import { z } from 'zod'

export const AuditLogSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().nullable().optional(),
  username: z.string().nullable().optional(),
  action: z.string(),
  resource: z.string().nullable().optional(),
  resourceId: z.number().nullable().optional(),
  oldValue: z.unknown().nullable().optional(),
  newValue: z.unknown().nullable().optional(),
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
})

export type AuditLog = z.infer<typeof AuditLogSchema>
