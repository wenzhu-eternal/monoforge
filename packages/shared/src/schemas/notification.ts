import { z } from 'zod'

export const NotificationSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  type: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.coerce.date(),
})

export type Notification = z.infer<typeof NotificationSchema>
