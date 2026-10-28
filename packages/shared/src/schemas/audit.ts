import { z } from 'zod'

/**
 * Q15：审计日志读侧契约是 DB 列的超集，勿据此反推 DDL：
 * - `username` 为 join users 派生的展示字段（非 audit_logs 列）
 * - `userId`/`resource` 比 DB NOT NULL 宽（读侧容差：软删用户 join 不到时为空）
 * - `userId = 0` 表示系统动作（cron/启动钩子），不是真实用户
 */
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
