import { z } from 'zod'
import { RoleSchema } from './role'

// 中国大陆手机号: 1 开头 + 第二位 3-9 + 9 位数字
export const PhoneSchema = z
  .string()
  .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
  .optional()

export const UserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(3).max(50),
  email: z.string().email(),
  nickname: z.string().max(50).optional(),
  avatar: z.string().url().optional(),
  phone: PhoneSchema,
  roleId: z.number().int().positive().nullable().optional(),
  status: z.boolean(),
  roles: z.array(RoleSchema).optional(),
  permissions: z.array(z.string()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
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

export type User = z.infer<typeof UserSchema>
export type CreateUser = z.infer<typeof CreateUserSchema>
export type UpdateUser = z.infer<typeof UpdateUserSchema>
export type Login = z.infer<typeof LoginSchema>
export type Register = z.infer<typeof RegisterSchema>
