import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { RolePermission } from '@shared/schemas/permission'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { permissions, rolePermissions, roles } from '@/db/schema'
import { RedisService } from '@/modules/redis/redis.service'

@Injectable()
export class RolePermissionsService {
  private readonly logger = new Logger(RolePermissionsService.name)

  constructor(private readonly redisService: RedisService) {}
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
    caller?: { userId: number; roleId: number | null; isAdmin: boolean },
  ): Promise<{ message: string; skipped: string[] }> {
    const role = await db.query.roles.findFirst({
      where: and(eq(roles.id, roleId), notDeleted(roles.deletedAt)),
    })
    if (!role) {
      throw new NotFoundException(`角色 ID ${roleId} 不存在`)
    }

    // 防自提权: 非 admin 禁止修改自己所属角色的权限集合
    if (caller && !caller.isAdmin && caller.roleId === roleId) {
      throw new ForbiddenException('不能修改自己所属角色的权限')
    }

    // 过滤掉指向已软删权限的 code
    let validCodes: string[] = []
    if (permissionCodes.length > 0) {
      const valid = await db
        .select({ code: permissions.code })
        .from(permissions)
        .where(and(inArray(permissions.code, permissionCodes), notDeleted(permissions.deletedAt)))
      validCodes = valid.map((p) => p.code)
    }
    const skipped = permissionCodes.filter((c) => !validCodes.includes(c))

    // M2：传入码全部无效（含全部指向已软删权限）时拒绝——否则事务会"删光旧权限、不插新权限"，
    // 构成无感的权限清空攻击；明确传空数组清空仍允许（PUT 已进审计留痕）
    if (permissionCodes.length > 0 && validCodes.length === 0) {
      throw new BadRequestException('传入的权限码均无效或已删除，未做任何变更')
    }

    // 防越权授予: 非 admin 授予的权限码不得超过调用者自身权限集（与 PermissionsGuard 同口径: innerJoin 过滤软删权限）
    if (caller && !caller.isAdmin && validCodes.length > 0) {
      const callerPerms = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .innerJoin(
          permissions,
          and(eq(rolePermissions.permission, permissions.code), notDeleted(permissions.deletedAt)),
        )
        .where(eq(rolePermissions.roleId, caller.roleId ?? -1))
      const callerSet = new Set(callerPerms.map((p) => p.permission))
      const exceeded = validCodes.filter((c) => !callerSet.has(c))
      if (exceeded.length > 0) {
        throw new ForbiddenException('不能授予自身未持有的权限')
      }
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

    // M12：缓存失效失败只告警，权限以 DB 为准（下次读自动回填），绝不能 unhandledRejection 拖垮进程
    void this.redisService
      .del(`perm:role:${roleId}`)
      .catch((err) => this.logger.warn(`角色权限缓存失效失败: ${err}`))

    return { message: `角色 ${role.name} 的权限已更新`, skipped }
  }
}
