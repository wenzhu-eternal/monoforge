import { z } from 'zod'
import { RoleBriefSchema } from './role'

export const PhoneSchema = z
  .string()
  .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
  .optional()

export const UserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(3).max(50),
  email: z.string().email(),
  nickname: z.string().max(50).nullable().optional(),
  avatar: z.string().url().nullable().optional(),
  phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
    .nullable()
    .optional(),
  roleId: z.number().int().positive().nullable().optional(),
  status: z.boolean(),
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
  roleName: z.string().nullable().optional(),
  roles: z.array(RoleBriefSchema).optional(),
})

export const CreateUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  nickname: z.string().max(50).optional(),
  phone: PhoneSchema,
  roleId: z.number().int().positive(),
})

export const UpdateUserSchema = z.object({
  email: z.string().email(),
  nickname: z.string().max(50).optional(),
  avatar: z.string().url().optional(),
  phone: PhoneSchema,
  status: z.boolean().optional(),
  password: z.string().min(6).max(100).optional(),
  roleId: z.number().int().positive(),
})

export const LoginSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
})

export const RegisterSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  nickname: z.string().max(50).optional(),
})

export const RegisterWithCodeSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  code: z.string().length(6, '验证码为 6 位数字'),
})

export const SendRegisterCodeSchema = z.object({
  email: z.string().email(),
})

export type User = z.infer<typeof UserSchema>
export type UserListItem = z.infer<typeof UserListItemSchema>
export type CreateUser = z.infer<typeof CreateUserSchema>
export type UpdateUser = z.infer<typeof UpdateUserSchema>
export type Login = z.infer<typeof LoginSchema>
export type Register = z.infer<typeof RegisterSchema>
export type RegisterWithCode = z.infer<typeof RegisterWithCodeSchema>
export type SendRegisterCode = z.infer<typeof SendRegisterCodeSchema>
