import { z } from 'zod'
import { RoleBriefSchema } from './role'
import { UserSchema } from './user'

export const RefreshTokenSchema = z.object({
  refreshToken: z.string(),
})

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

export type RefreshToken = z.infer<typeof RefreshTokenSchema>
export type AuthResponse = z.infer<typeof AuthResponseSchema>
export type RefreshTokenResponse = z.infer<typeof RefreshTokenResponseSchema>
