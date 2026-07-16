import { z } from 'zod'

export const SendWelcomeMailSchema = z.object({
  to: z.string().email('请输入有效邮箱'),
  username: z.string().min(1, '用户名不能为空').max(50, '用户名最多 50 字符'),
})

export const SendVerificationCodeMailSchema = z.object({
  to: z.string().email('请输入有效邮箱'),
  name: z.string().min(1).max(50).optional(),
})

export const MailSendResultSchema = z.object({
  message: z.string(),
})

export type SendWelcomeMail = z.infer<typeof SendWelcomeMailSchema>
export type SendVerificationCodeMail = z.infer<typeof SendVerificationCodeMailSchema>
export type MailSendResult = z.infer<typeof MailSendResultSchema>
