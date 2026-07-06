import { Injectable, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
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
    const result = await db.query.rolePermissions.findMany({
      where: eq(rolePermissions.roleId, roleId),
    })
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
      .where(eq(rolePermissions.roleId, roleId))

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

    return allPermissions
  }

  async updateRolePermissions(
    roleId: number,
    permissionCodes: string[],
  ): Promise<{ message: string }> {
    const role = await db.query.roles.findFirst({ where: eq(roles.id, roleId) })
    if (!role) {
      throw new NotFoundException(`角色 ID ${roleId} 不存在`)
    }

    // 删除旧权限
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))

    // 插入新权限
    if (permissionCodes.length > 0) {
      await db.insert(rolePermissions).values(
        permissionCodes.map((permission) => ({
          roleId,
          permission,
        })),
      )
    }

    return { message: `角色 ${role.name} 的权限已更新` }
  }
}
