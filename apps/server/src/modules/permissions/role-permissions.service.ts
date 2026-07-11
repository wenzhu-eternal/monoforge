import { Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { permissions, rolePermissions, roles } from '@/db/schema'

export interface RolePermission {
  roleId: number
  permission: string
  permissionName?: string | null
  roleName?: string
}

@Injectable()
export class RolePermissionsService {
  async findByRoleId(roleId: number): Promise<string[]> {
    const result = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .innerJoin(
        permissions,
        and(eq(rolePermissions.permission, permissions.code), notDeleted(permissions.deletedAt)),
      )
      .where(eq(rolePermissions.roleId, roleId))

    return result.map((p) => p.permission)
  }

  async findByRoleIdWithDetails(roleId: number): Promise<RolePermission[]> {
    const result = await db
      .select({
        roleId: rolePermissions.roleId,
        permission: rolePermissions.permission,
        permissionName: permissions.name,
      })
      .from(rolePermissions)
      .leftJoin(permissions, eq(rolePermissions.permission, permissions.code))
      .where(and(eq(rolePermissions.roleId, roleId), notDeleted(permissions.deletedAt)))

    return result
  }

  async findAll(): Promise<RolePermission[]> {
    const allPermissions = await db
      .select({
        roleId: rolePermissions.roleId,
        permission: rolePermissions.permission,
        permissionName: permissions.name,
        roleName: roles.name,
      })
      .from(rolePermissions)
      .leftJoin(permissions, eq(rolePermissions.permission, permissions.code))
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .where(and(notDeleted(permissions.deletedAt), notDeleted(roles.deletedAt)))

    return allPermissions
  }

  async updateRolePermissions(
    roleId: number,
    permissionCodes: string[],
  ): Promise<{ message: string }> {
    const role = await db.query.roles.findFirst({
      where: and(eq(roles.id, roleId), notDeleted(roles.deletedAt)),
    })
    if (!role) {
      throw new NotFoundException(`角色 ID ${roleId} 不存在`)
    }

    // 静默过滤掉指向已软删权限的 code，避免幽灵权限
    let validCodes: string[] = []
    if (permissionCodes.length > 0) {
      const valid = await db
        .select({ code: permissions.code })
        .from(permissions)
        .where(and(inArray(permissions.code, permissionCodes), notDeleted(permissions.deletedAt)))
      validCodes = valid.map((p) => p.code)
    }

    // 删除旧权限并插入新权限（事务保证原子性，避免 insert 失败导致权限丢失）
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))

      if (validCodes.length > 0) {
        await tx.insert(rolePermissions).values(
          validCodes.map((permission) => ({
            roleId,
            permission,
          })),
        )
      }
    })

    return { message: `角色 ${role.name} 的权限已更新` }
  }
}
