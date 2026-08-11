import { z } from 'zod'
import { UserEmailSchema } from './user'

export const SetupSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少 3 个字符')
    .max(50, '用户名最多 50 个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字、下划线'),
  email: UserEmailSchema,
  password: z.string().min(6, '密码至少 6 个字符').max(100, '密码最多 100 个字符'),
  nickname: z.string().max(50).optional(),
})

export const SetupStatusSchema = z.object({
  initialized: z.boolean(),
})

export const SetupResultSchema = z.object({
  message: z.string(),
  adminUsername: z.string(),
})

export const RouteMetaSchema = z.object({
  path: z.string(),
  method: z.string(),
  controller: z.string(),
  handlerName: z.string(),
})

export const RouteListSchema = z.array(RouteMetaSchema)

export type Setup = z.infer<typeof SetupSchema>
export type SetupStatus = z.infer<typeof SetupStatusSchema>
export type SetupResult = z.infer<typeof SetupResultSchema>
export type RouteMeta = z.infer<typeof RouteMetaSchema>
