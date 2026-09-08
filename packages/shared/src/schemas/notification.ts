import { z } from 'zod'

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

export type Notification = z.infer<typeof NotificationSchema>
export type WebSocketOnline = z.infer<typeof WebSocketOnlineSchema>
export type WebSocketMe = z.infer<typeof WebSocketMeSchema>
export type WebSocketNotifyResult = z.infer<typeof WebSocketNotifyResultSchema>
