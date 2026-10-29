import { NotifySchema, PasswordSchema, PhoneSchema, UserEmailSchema, UsernameSchema } from '@shared'
import type { Rule } from 'antd/es/form'
import { ZodNullable, ZodOptional, type ZodString, type ZodType } from 'zod'

/** L19：写侧 schema 可能叠加 optional + nullable，逐层解包到底层 ZodString */
function unwrapStringSchema(schema: ZodType): ZodString {
  let current: unknown = schema
  while (current instanceof ZodOptional || current instanceof ZodNullable) {
    current = current.unwrap()
  }
  return current as ZodString
}

/**
 * L24：长度校验直接读 shared schema 的 minLength/maxLength——前端不再手写数字，
 * 契约调整时表单提示自动跟随（required 仍由各表单项自行声明）
 */
export function schemaLengthRule(schema: ZodType, label: string): Rule {
  const stringSchema = unwrapStringSchema(schema)
  return {
    validator: (_, value: string | undefined) => {
      if (!value) return Promise.resolve()
      const { minLength, maxLength } = stringSchema
      if (minLength !== null && value.length < minLength) {
        return Promise.reject(new Error(`${label}至少 ${minLength} 个字符`))
      }
      if (maxLength !== null && value.length > maxLength) {
        return Promise.reject(new Error(`${label}最多 ${maxLength} 个字符`))
      }
      return Promise.resolve()
    },
  }
}

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

/**
 * WebSocket 通知标题：复用 shared NotifySchema，长度/文案与后端 DTO 保持一致
 */
export const notifyTitleRule: Rule = {
  validator: (_, value: string) => {
    if (!value) return Promise.resolve()
    const result = NotifySchema.shape.title.safeParse(value)
    return result.success
      ? Promise.resolve()
      : Promise.reject(new Error(result.error.issues[0]?.message ?? '标题格式不正确'))
  },
}

/**
 * WebSocket 通知内容：可选，空值放行；长度上限复用 shared NotifySchema
 */
export const notifyContentRule: Rule = {
  validator: (_, value: string | undefined) => {
    const result = NotifySchema.shape.content.safeParse(value || undefined)
    return result.success
      ? Promise.resolve()
      : Promise.reject(new Error(result.error.issues[0]?.message ?? '内容格式不正确'))
  },
}
