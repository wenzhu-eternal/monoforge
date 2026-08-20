import { z } from 'zod'
import { RoleBriefSchema } from './role'

export const PhoneSchema = z
  .string()
  .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
  .optional()

// 拒绝微信登录占位邮箱域，防止攻击者抢占领位邮箱导致微信用户无法登录
export const UserEmailSchema = z
  .string()
  .email()
  .refine((email) => !email.endsWith('@wechat.placeholder'), '该邮箱域为系统保留')

// 用户名统一正则：与 SetupSchema 保持一致，防注入空格/控制符/HTML
export const UsernameSchema = z
  .string()
  .min(3, '用户名至少 3 个字符')
  .max(50, '用户名最多 50 个字符')
  .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字、下划线')

// 密码策略：至少 8 位且同时包含字母与数字（注册/建户/改密共用；纯数字如生日密码被拒）
export const PasswordSchema = z
  .string()
  .min(8, '密码至少 8 个字符')
  .max(100, '密码最多 100 个字符')
  .regex(/^(?=.*[a-zA-Z])(?=.*\d).+$/, '密码必须同时包含字母和数字')

export const UserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(3).max(50),
  email: z.string().email(),
  nickname: z.string().max(50).nullable().optional(),
  avatar: z.string().nullable().optional(),
  phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
    .nullable()
    .optional(),
  roleId: z.number().int().positive().nullable().optional(),
  status: z.boolean(),
  mustChangePassword: z.boolean().default(false),
  deletedAt: z.coerce.date().nullable().optional(),
  roleName: z.string().nullable().optional(),
  roles: z.array(RoleBriefSchema).optional(),
  permissions: z.array(z.string()).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const UserListItemSchema = UserSchema.pick({
  id: true,
  username: true,
  email: true,
  nickname: true,
  avatar: true,
  phone: true,
  roleId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  deletedAt: z.coerce.date().nullable().optional(),
  roleName: z.string().nullable().optional(),
  roles: z.array(RoleBriefSchema).optional(),
})

export const CreateUserSchema = z.object({
  username: UsernameSchema,
  email: UserEmailSchema,
  password: PasswordSchema,
  nickname: z.string().max(50).optional(),
  phone: PhoneSchema,
  // 角色: 仅 USER_ROLE_MANAGE 权限可指定，其余调用方由服务端默认分配普通角色
  roleId: z.number().int().positive().optional(),
  // 默认 true 强制首登改密（管理员指定的密码不应被长期沿用）；显式 false 为管理员知情豁免（如 e2e 夹具）
  mustChangePassword: z.boolean().optional(),
})

export const UpdateUserSchema = z.object({
  email: UserEmailSchema.optional(),
  nickname: z.string().max(50).optional(),
  avatar: z.string().url().max(255).optional(),
  phone: PhoneSchema,
  status: z.boolean().optional(),
  password: PasswordSchema.optional(),
  roleId: z.number().int().positive().optional(),
})

// 修改自己密码：必须验证旧密码，防止 token 泄露后被改密码锁账号
export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入旧密码'),
  newPassword: PasswordSchema,
})

export const LoginSchema = z.object({
  username: UsernameSchema,
  // 登录不套用注册级密码策略：历史弱密码用户需能登录后走改密流程，真实性由 argon2 校验
  password: z.string().min(1, '请输入密码').max(100),
})

export const RegisterWithCodeSchema = z.object({
  username: UsernameSchema,
  email: UserEmailSchema,
  password: PasswordSchema,
  code: z.string().length(6, '验证码为 6 位数字'),
})

export const SendRegisterCodeSchema = z.object({
  email: UserEmailSchema,
})

export type User = z.infer<typeof UserSchema>
export type UserListItem = z.infer<typeof UserListItemSchema>
export type CreateUser = z.infer<typeof CreateUserSchema>
export type UpdateUser = z.infer<typeof UpdateUserSchema>
export type ChangePassword = z.infer<typeof ChangePasswordSchema>
export type Login = z.infer<typeof LoginSchema>
export type RegisterWithCode = z.infer<typeof RegisterWithCodeSchema>
export type SendRegisterCode = z.infer<typeof SendRegisterCodeSchema>
