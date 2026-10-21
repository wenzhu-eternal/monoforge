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
