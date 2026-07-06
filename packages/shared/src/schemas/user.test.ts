import { describe, expect, it } from 'vitest'
import {
  CreateUserSchema,
  LoginSchema,
  PhoneSchema,
  RegisterSchema,
  UpdateUserSchema,
  UserSchema,
} from './user'

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

  it('密码少于 6 位失败', () => {
    const result = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'alice@example.com',
      password: '12345',
      roleId: 1,
    })
    expect(result.success).toBe(false)
  })

  it('roleId 必填且为正整数', () => {
    const r1 = CreateUserSchema.safeParse({
      username: 'alice',
      email: 'alice@example.com',
      password: 'secret123',
    })
    expect(r1.success).toBe(false)

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
  it('email 必填', () => {
    const r = UpdateUserSchema.safeParse({ roleId: 1 })
    expect(r.success).toBe(false)
  })

  it('roleId 必填', () => {
    const r = UpdateUserSchema.safeParse({ email: 'a@b.com' })
    expect(r.success).toBe(false)
  })

  it('合法数据通过', () => {
    const r = UpdateUserSchema.safeParse({ email: 'a@b.com', roleId: 1 })
    expect(r.success).toBe(true)
  })
})

describe('LoginSchema', () => {
  it('合法数据通过', () => {
    expect(LoginSchema.safeParse({ username: 'alice', password: 'secret123' }).success).toBe(true)
  })

  it('密码过短失败', () => {
    expect(LoginSchema.safeParse({ username: 'alice', password: '123' }).success).toBe(false)
  })

  it('用户名过短失败', () => {
    expect(LoginSchema.safeParse({ username: 'ab', password: 'secret123' }).success).toBe(false)
  })
})

describe('RegisterSchema', () => {
  it('合法数据通过', () => {
    expect(
      RegisterSchema.safeParse({
        username: 'alice',
        email: 'alice@example.com',
        password: 'secret123',
      }).success,
    ).toBe(true)
  })

  it('nickname 可选', () => {
    expect(
      RegisterSchema.safeParse({
        username: 'alice',
        email: 'alice@example.com',
        password: 'secret123',
        nickname: 'Alice',
      }).success,
    ).toBe(true)
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
