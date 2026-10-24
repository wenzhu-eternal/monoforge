import { DEFAULT_PERMISSIONS } from '@shared/constants/default-seed'
import { PermissionCodes } from '@shared/constants/permissions'
import { describe, expect, it } from 'vitest'
import { assertAdminUsernameAvailable } from './seed-guards'

describe('assertAdminUsernameAvailable（M1）', () => {
  it('username=admin 被普通角色占用时抛错，阻止 upsert 重置密码', () => {
    expect(() => assertAdminUsernameAvailable({ id: 7, roleId: 2 }, 1)).toThrow(
      /已被非管理员账号占用.*用户 ID 7/,
    )
  })

  it('username=admin 被其他非 admin 角色占用时同样抛错', () => {
    expect(() => assertAdminUsernameAvailable({ id: 8, roleId: 9 }, 1)).toThrow(/roleId 9/)
  })

  it('无活跃占位用户时放行', () => {
    expect(() => assertAdminUsernameAvailable(undefined, 1)).not.toThrow()
  })

  it('已存在 admin 角色用户时放行（调用方已提前 return，不进入补建）', () => {
    expect(() => assertAdminUsernameAvailable({ id: 1, roleId: 1 }, 1)).not.toThrow()
  })
})

describe('DEFAULT_PERMISSIONS 路由清单（L14）', () => {
  const routesOf = (code: string) =>
    DEFAULT_PERMISSIONS.find((permission) => permission.code === code)?.routes ?? []

  it('删除类权限同时覆盖 remove 与 restore 两条路由', () => {
    expect(routesOf(PermissionCodes.USER_DELETE)).toContain('POST /users/:id/restore')
    expect(routesOf(PermissionCodes.ROLE_DELETE)).toContain('POST /roles/:id/restore')
    expect(routesOf(PermissionCodes.PERMISSION_DELETE)).toContain('POST /permissions/:id/restore')
    expect(routesOf(PermissionCodes.FILE_DELETE)).toContain('POST /files/:id/restore')
  })

  it('权限码无重复', () => {
    const codes = DEFAULT_PERMISSIONS.map((permission) => permission.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
