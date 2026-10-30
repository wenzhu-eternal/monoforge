import { z } from 'zod'

/**
 * Q15：审计日志读侧契约是 DB 列的有损投影，勿据此反推 DDL：
 * - `username` 为 join users 派生的展示字段（非 audit_logs 列）；该 leftJoin 不过滤 users.deletedAt，
 *   用户软删后仍照常回显历史用户名
 * - `userId`/`resource` 比 DB NOT NULL 宽（读侧容差：join 不到用户时为空）
 * - `userId = 0` 为匿名哨兵（登录失败、登录成功前的账密/微信请求等无身份请求），
 *   不是系统动作——全仓仅 AuditInterceptor 写库，cron/启动钩子不入审计
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
