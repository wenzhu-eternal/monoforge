import { PasswordSchema, PhoneSchema, UserEmailSchema, UsernameSchema } from '@shared'
import type { Rule } from 'antd/es/form'

/**
 * 密码校验规则：直接复用 shared 的 PasswordSchema，避免前端手写规则与后端契约漂移
 */
export const passwordRule: Rule = {
  validator: (_, value: string) => {
    if (!value) return Promise.resolve()
    const result = PasswordSchema.safeParse(value)
    return result.success
      ? Promise.resolve()
      : Promise.reject(new Error(result.error.issues[0]?.message ?? '密码格式不正确'))
  },
}

/**
 * 用户名校验：复用 shared UsernameSchema，保证前后端 min/max/regex 一致
 */
export const usernameRule: Rule = {
  validator: (_, value: string) => {
    if (!value) return Promise.resolve()
    const result = UsernameSchema.safeParse(value)
    return result.success
      ? Promise.resolve()
      : Promise.reject(new Error(result.error.issues[0]?.message ?? '用户名格式不正确'))
  },
}

/**
 * 邮箱校验：复用 shared UserEmailSchema（含 @wechat.placeholder 域拒绝）
 */
export const emailRule: Rule = {
  validator: (_, value: string) => {
    if (!value) return Promise.resolve()
    const result = UserEmailSchema.safeParse(value)
    return result.success
      ? Promise.resolve()
      : Promise.reject(new Error(result.error.issues[0]?.message ?? '邮箱格式不正确'))
  },
}

/**
 * 手机号校验：复用 shared PhoneSchema
 */
export const phoneRule: Rule = {
  validator: (_, value: string) => {
    if (!value) return Promise.resolve()
    const result = PhoneSchema.safeParse(value)
    return result.success
      ? Promise.resolve()
      : Promise.reject(new Error(result.error.issues[0]?.message ?? '手机号格式不正确'))
  },
}
