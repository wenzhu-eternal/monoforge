import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { DEFAULT_PERMISSIONS } from '@shared/constants/default-seed'
import { PermissionCodes } from '@shared/constants/permissions'
import { describe, expect, it } from 'vitest'
import { PERMISSIONS_KEY } from '@/common/decorators/permissions.decorator'
import { RolePermissionsController } from '@/modules/permissions/role-permissions.controller'
import { RoutesController } from '@/modules/routes/routes.controller'
import { assertAdminUsernameAvailable } from './seed-guards'

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
}

type ControllerClass = new (...args: never[]) => object

/** 从 controller 反射出 `${METHOD} /path` 与 @Permissions 码（方法级优先，类级兜底） */
function collectControllerRoutes(controller: ControllerClass) {
  const proto = controller.prototype as Record<string, unknown>
  const classPath = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? ''
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .flatMap((name) => {
      const handler = proto[name] as object
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
      if (method === undefined || path === undefined) return []
      const fullPath = [classPath, path].join('/').split('/').filter(Boolean).join('/')
      const permissions =
        ((Reflect.getMetadata(PERMISSIONS_KEY, handler) ??
          Reflect.getMetadata(PERMISSIONS_KEY, controller)) as string[] | undefined) ?? []
      return [{ route: `${METHOD_NAMES[method]} /${fullPath}`, permissions }]
    })
}

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

describe('DEFAULT_PERMISSIONS 路由清单与 controller 全覆盖（L23）', () => {
  const routesOf = (code: string) =>
    DEFAULT_PERMISSIONS.find((permission) => permission.code === code)?.routes ?? []

  it('role-permissions 三端点与 routes 端点在白名单中', () => {
    expect(routesOf(PermissionCodes.PERMISSION_VIEW)).toEqual(
      expect.arrayContaining([
        'GET /role-permissions',
        'GET /role-permissions/role/:roleId',
        'GET /routes',
      ]),
    )
    expect(routesOf(PermissionCodes.PERMISSION_UPDATE)).toContain(
      'PUT /role-permissions/role/:roleId',
    )
  })

  it('RolePermissionsController/RoutesController 的每个受保护端点都被清单覆盖', () => {
    for (const controller of [RolePermissionsController, RoutesController]) {
      const routes = collectControllerRoutes(controller)
      expect(routes.length).toBeGreaterThan(0)
      for (const { route, permissions } of routes) {
        expect(permissions.length, `${route} 缺少 @Permissions`).toBeGreaterThan(0)
        for (const code of permissions) {
          // routes 白名单是权限码不足时的兜底授权面——漏标即该端点对 routes-only 角色不可达
          expect(routesOf(code), `${code} 未在 DEFAULT_PERMISSIONS`).toContain(route)
        }
      }
    }
  })
})
