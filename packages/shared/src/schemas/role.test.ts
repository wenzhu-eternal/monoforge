import { describe, expect, it } from 'vitest'
import { CreateRoleSchema, RoleSchema, UpdateRoleSchema } from './role'

describe('CreateRoleSchema', () => {
  it('合法数据通过', () => {
    expect(CreateRoleSchema.safeParse({ name: 'admin' }).success).toBe(true)
  })

  it('带描述通过', () => {
    expect(CreateRoleSchema.safeParse({ name: 'admin', description: '管理员' }).success).toBe(true)
  })

  it('name 为空失败', () => {
    expect(CreateRoleSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('name 超过 50 字符失败', () => {
    expect(CreateRoleSchema.safeParse({ name: 'a'.repeat(51) }).success).toBe(false)
  })
})

describe('UpdateRoleSchema', () => {
  it('name 可选', () => {
    expect(UpdateRoleSchema.safeParse({}).success).toBe(true)
  })

  it('name 合法通过', () => {
    expect(UpdateRoleSchema.safeParse({ name: 'editor' }).success).toBe(true)
  })

  it('name 为空字符串失败', () => {
    expect(UpdateRoleSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('RoleSchema', () => {
  it('合法数据通过', () => {
    const r = RoleSchema.safeParse({
      id: 1,
      name: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(r.success).toBe(true)
  })

  it('id 非正整数失败', () => {
    expect(
      RoleSchema.safeParse({
        id: 0,
        name: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      }).success,
    ).toBe(false)
  })

  it('缺少 createdAt 失败', () => {
    expect(RoleSchema.safeParse({ id: 1, name: 'admin', updatedAt: new Date() }).success).toBe(
      false,
    )
  })
})
