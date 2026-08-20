import { describe, expect, it } from 'vitest'
import { CreateUserSchema, LoginSchema, PhoneSchema, UpdateUserSchema, UserSchema } from './user'

describe('PhoneSchema', () => {
  it('接受合法中国大陆手机号', () => {
    expect(PhoneSchema.safeParse('13800138000').success).toBe(true)
    expect(PhoneSchema.safeParse('19912345678').success).toBe(true)
  })

  it('拒绝非法手机号', () => {
    expect(PhoneSchema.safeParse('12345678901').success).toBe(false) // 第二位非 3-9
    expect(PhoneSchema.safeParse('1380013800').success).toBe(false) // 少一位
    expect(PhoneSchema.safeParse('138001380001').success).toBe(false) // 多一位
    expect(PhoneSchema.safeParse('abc').success).toBe(false)
  })

  it('可选字段，未传 undefined 也合法', () => {
    expect(PhoneSchema.safeParse(undefined).success).toBe(true)
  })
})

describe('CreateUserSchema', () => {
  it('合法数据通过校验', () => {
    const result = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'alice@example.com',
      password: 'secret123',
      roleId: 1,
    })
    expect(result.success).toBe(true)
  })

  it('邮箱格式不合法时失败', () => {
    const result = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'not-email',
      password: 'secret123',
      roleId: 1,
    })
    expect(result.success).toBe(false)
  })

  it('密码少于 8 位失败', () => {
    const result = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'alice@example.com',
      password: 'abc123',
    })
    expect(result.success).toBe(false)
  })

  it('纯数字密码失败（须含字母）', () => {
    const result = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'alice@example.com',
      password: '12345678',
    })
    expect(result.success).toBe(false)
  })

  it('纯字母密码失败（须含数字）', () => {
    const result = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'alice@example.com',
      password: 'abcdefgh',
    })
    expect(result.success).toBe(false)
  })

  it('roleId 可选，未传时合法（服务端默认分配），非正整数失败', () => {
    const r1 = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'alice@example.com',
      password: 'secret123',
    })
    expect(r1.success).toBe(true)

    const r2 = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'alice@example.com',
      password: 'secret123',
      roleId: 0,
    })
    expect(r2.success).toBe(false)
  })
})

describe('UpdateUserSchema', () => {
  it('支持局部更新（仅传 email）', () => {
    const r = UpdateUserSchema.safeParse({ email: 'a@b.com' })
    expect(r.success).toBe(true)
  })

  it('支持局部更新（仅传 roleId）', () => {
    const r = UpdateUserSchema.safeParse({ roleId: 1 })
    expect(r.success).toBe(true)
  })

  it('合法数据通过', () => {
    const r = UpdateUserSchema.safeParse({ email: 'a@b.com', roleId: 1 })
    expect(r.success).toBe(true)
  })

  it('非法 email 失败', () => {
    const r = UpdateUserSchema.safeParse({ email: 'not-email' })
    expect(r.success).toBe(false)
  })

  it('非法 roleId 失败', () => {
    const r = UpdateUserSchema.safeParse({ roleId: 0 })
    expect(r.success).toBe(false)
  })
})

describe('LoginSchema', () => {
  it('合法数据通过', () => {
    expect(LoginSchema.safeParse({ username: 'alice', password: 'secret123' }).success).toBe(true)
  })

  it('历史弱密码也可登录（不套用注册级策略，走改密流程）', () => {
    expect(LoginSchema.safeParse({ username: 'alice', password: '888888' }).success).toBe(true)
  })

  it('密码为空失败', () => {
    expect(LoginSchema.safeParse({ username: 'alice', password: '' }).success).toBe(false)
  })

  it('用户名过短失败', () => {
    expect(LoginSchema.safeParse({ username: 'ab', password: 'secret123' }).success).toBe(false)
  })
})

describe('UserSchema', () => {
  it('合法数据通过（含可选字段）', () => {
    const r = UserSchema.safeParse({
      id: 1,
      username: 'alice',
      email: 'alice@example.com',
      status: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(r.success).toBe(true)
  })

  it('缺少必填字段失败', () => {
    const r = UserSchema.safeParse({ id: 1, username: 'alice' })
    expect(r.success).toBe(false)
  })
})
