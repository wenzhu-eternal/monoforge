import { z } from 'zod'
import { PasswordSchema, UserEmailSchema, UsernameSchema } from './user'

export const SetupSchema = z.object({
  username: UsernameSchema,
  email: UserEmailSchema,
  password: PasswordSchema,
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
