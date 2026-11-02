import { z } from 'zod'
import { RoleBriefSchema } from './role'
import { UserSchema } from './user'

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  user: UserSchema.extend({
    roles: z.array(RoleBriefSchema).optional(),
    permissions: z.array(z.string()).optional(),
  }),
})

export const RefreshTokenResponseSchema = z.object({
  accessToken: z.string(),
})

export type AuthResponse = z.infer<typeof AuthResponseSchema>
