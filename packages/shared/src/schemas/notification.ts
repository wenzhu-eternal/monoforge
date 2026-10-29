import { z } from 'zod'

// L22：WebSocket 测试通知入参契约与后端 DTO 共用，前端表单规则不再手写长度
// L16：写侧统一 strictObject——多传字段 400，不静默 strip
export const NotifySchema = z.strictObject({
  userId: z.number().int().positive('用户 ID 必须为正整数'),
  type: z.string().min(1, '类型不能为空').max(50, '类型最多 50 字符'),
  title: z.string().min(1, '标题不能为空').max(200, '标题最多 200 字符'),
  content: z.string().max(2000, '内容最多 2000 字符').optional(),
})

export const NotificationSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  type: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.coerce.date(),
  deletedAt: z.coerce.date().nullable().optional(),
})

export const WebSocketOnlineSchema = z.object({
  count: z.number(),
  userIds: z.array(z.number()),
})

export const WebSocketMeSchema = z.object({
  userId: z.number(),
  online: z.boolean(),
})

export const WebSocketNotifyResultSchema = z.object({
  message: z.string(),
  notification: NotificationSchema,
  delivered: z.boolean(),
})

export type Notify = z.infer<typeof NotifySchema>
export type Notification = z.infer<typeof NotificationSchema>
export type WebSocketOnline = z.infer<typeof WebSocketOnlineSchema>
export type WebSocketMe = z.infer<typeof WebSocketMeSchema>
export type WebSocketNotifyResult = z.infer<typeof WebSocketNotifyResultSchema>
