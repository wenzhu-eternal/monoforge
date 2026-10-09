import { describe, expect, it } from 'vitest'
import { UpdateRolePermissionsSchema } from './permission'

describe('UpdateRolePermissionsSchema（L2 上限）', () => {
  it('空数组通过（解绑全部权限）', () => {
    expect(UpdateRolePermissionsSchema.safeParse({ permissions: [] }).success).toBe(true)
  })

  it('常规权限码列表通过', () => {
    expect(
      UpdateRolePermissionsSchema.safeParse({ permissions: ['user:view', 'role:create'] }).success,
    ).toBe(true)
  })

  it('超过 50 个权限码失败（防打穿 PG 绑定参数上限）', () => {
    const permissions = Array.from({ length: 51 }, (_, i) => `perm:${i}`)
    expect(UpdateRolePermissionsSchema.safeParse({ permissions }).success).toBe(false)
  })

  it('单元素超 50 字符失败（对齐 permissions.code varchar(50)）', () => {
    expect(UpdateRolePermissionsSchema.safeParse({ permissions: ['a'.repeat(51)] }).success).toBe(
      false,
    )
  })
})
