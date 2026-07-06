import { z } from 'zod'

export const SendWelcomeMailSchema = z.object({
  to: z.string().email('请输入有效邮箱'),
  username: z.string().min(1, '用户名不能为空').max(50, '用户名最多 50 字符'),
})

export const SendVerificationCodeMailSchema = z.object({
  to: z.string().email('请输入有效邮箱'),
  code: z
    .string()
    .min(4, '验证码至少 4 位')
    .max(8, '验证码最多 8 位')
    .regex(/^\d+$/, '验证码只能为数字'),
  name: z.string().min(1).max(50).optional(),
})

export type SendWelcomeMail = z.infer<typeof SendWelcomeMailSchema>
export type SendVerificationCodeMail = z.infer<typeof SendVerificationCodeMailSchema>
