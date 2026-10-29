import { z } from 'zod'
import { UserEmailSchema } from './user'

// L16：写侧统一 strictObject
export const SendWelcomeMailSchema = z.strictObject({
  to: UserEmailSchema,
  username: z.string().min(1, '用户名不能为空').max(50, '用户名最多 50 字符'),
})

export const SendVerificationCodeMailSchema = z.strictObject({
  to: UserEmailSchema,
  name: z.string().min(1).max(50).optional(),
})

export const MailSendResultSchema = z.object({
  message: z.string(),
})

export type SendWelcomeMail = z.infer<typeof SendWelcomeMailSchema>
export type SendVerificationCodeMail = z.infer<typeof SendVerificationCodeMailSchema>
export type MailSendResult = z.infer<typeof MailSendResultSchema>
