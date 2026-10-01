import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import type { Permission } from '@shared/schemas/permission'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, maybeDeleted, notDeleted } from '@/db/helpers'
import { permissions, rolePermissions, roles } from '@/db/schema'
import { RedisService } from '@/modules/redis/redis.service'

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name)

  constructor(private readonly redisService: RedisService) {}

  // 权限码变更（改名/软删/恢复）会影响所有引用该码的角色缓存，统一失效
  // M5：失效失败只告警（下次读 DB 自愈），绝不能 unhandledRejection 拖垮进程
  private invalidateRolePermissionCache(): void {
    void this.redisService
      .deleteByPattern('perm:role:*')
      .catch((err) => this.logger.warn(`角色权限缓存失效失败: ${err}`))
  }
  async findAll(
    page = 1,
    pageSize = 10,
    includeDeleted = false,
  ): Promise<PaginatedResponse<Permission>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize
    const deletedFilter = maybeDeleted(permissions.deletedAt, includeDeleted)

    const [items, countResult] = await Promise.all([
      db.query.permissions.findMany({
        where: and(deletedFilter),
        limit: safePageSize,
        offset,
        orderBy: [desc(permissions.createdAt)],
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(permissions).where(and(deletedFilter)),
    ])

    const total = countResult[0]?.count ?? 0

    return {
      list: items,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize) || 1,
    }
  }

  async findAllList(): Promise<Permission[]> {
    return db.query.permissions.findMany({
      where: notDeleted(permissions.deletedAt),
      orderBy: [desc(permissions.createdAt)],
    })
  }

  async findById(id: number, includeDeleted = false): Promise<Permission> {
    const deletedFilter = maybeDeleted(permissions.deletedAt, includeDeleted)
    const permission = await db.query.permissions.findFirst({
      where: and(eq(permissions.id, id), deletedFilter),
    })
    if (!permission) {
      throw new NotFoundException(`权限 ID ${id} 不存在`)
    }
    return permission
  }

  async findByCode(code: string): Promise<Permission | undefined> {
    return db.query.permissions.findFirst({
      where: and(eq(permissions.code, code), notDeleted(permissions.deletedAt)),
    })
  }

  // M1：routes 是权限码矩阵之外的第二授权面（PermissionsGuard 兜底直接放行匹配路由），
  // 委托管理员若可编辑 routes 即可给自己持有的码追加任意路由实现提权，仅超管可配置
  private assertRoutesEditable(data: { routes?: string[] }, isAdmin: boolean): void {
    if (data.routes !== undefined && !isAdmin) {
      throw new ForbiddenException('仅超级管理员可配置权限的路由白名单')
    }
  }

  async create(
    data: {
      code: string
      name: string
      description?: string
      routes?: string[]
    },
    caller: { isAdmin: boolean },
  ): Promise<Permission> {
    this.assertRoutesEditable(data, caller.isAdmin)
    const existing = await db.query.permissions.findFirst({
      where: and(eq(permissions.code, data.code), notDeleted(permissions.deletedAt)),
    })
    if (existing) {
      throw new ConflictException('权限码已存在')
    }

    try {
      const [created] = await db.insert(permissions).values(data).returning()
      if (!created) {
        throw new ConflictException('创建权限失败')
      }
      return created
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('权限码已存在')
      }
      throw error
    }
  }

  async update(
    id: number,
    data: { code?: string; name?: string; description?: string; routes?: string[] },
    caller: { isAdmin: boolean },
  ): Promise<Permission> {
    this.assertRoutesEditable(data, caller.isAdmin)
    const existing = await db.query.permissions.findFirst({
      where: and(eq(permissions.id, id), notDeleted(permissions.deletedAt)),
    })
    if (!existing) {
      throw new NotFoundException(`权限 ID ${id} 不存在`)
    }

    if (data.code && data.code !== existing.code) {
      const dup = await db.query.permissions.findFirst({
        where: and(eq(permissions.code, data.code), notDeleted(permissions.deletedAt)),
      })
      if (dup) {
        throw new ConflictException('权限码已存在')
      }
    }

    // 改 code 时在事务中同步 role_permissions 绑定（该表以 code 字符串关联角色）:
    // 不同步则旧绑定成为孤儿记录，innerJoin 匹配不到，引用角色会静默失去该权限。
    // M4：必须先更新主表再改绑定——原先顺序下主表更新落空（并发软删）时绑定已改且已提交，无回滚。
    // L1：并发改码撞 permissions_code_unique 时兜底转 409（与 roles/users 风格一致，防裸 500）
    let updated: Permission | undefined
    try {
      if (data.code && data.code !== existing.code) {
        updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(permissions)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(permissions.id, id), notDeleted(permissions.deletedAt)))
            .returning()
          // 主表落空（并发软删/删除）直接抛，事务回滚，rolePermissions 保持旧码不断链
          if (!row) {
            throw new NotFoundException(`更新权限 ID ${id} 失败`)
          }
          await tx
            .update(rolePermissions)
            .set({ permission: data.code as string })
            .where(eq(rolePermissions.permission, existing.code))
          return row
        })
      } else {
        const [row] = await db
          .update(permissions)
          .set({ ...data, updatedAt: new Date() })
          // P2-5：与改码分支同口径，并发软删行不再误更新
          .where(and(eq(permissions.id, id), notDeleted(permissions.deletedAt)))
          .returning()
        updated = row
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('权限码已存在（并发冲突）')
      }
      throw error
    }

    if (!updated) {
      throw new NotFoundException(`更新权限 ID ${id} 失败`)
    }
    this.invalidateRolePermissionCache()
    return updated
  }

  async remove(id: number): Promise<{ message: string }> {
    const existing = await db.query.permissions.findFirst({
      where: and(eq(permissions.id, id), notDeleted(permissions.deletedAt)),
    })
    if (!existing) {
      throw new NotFoundException(`权限 ID ${id} 不存在`)
    }

    // 绑定校验: 仅统计未软删角色的引用（L11：已删角色的残留绑定是幽灵引用，不应阻塞删除）
    const bindings = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(rolePermissions.permission, existing.code), notDeleted(roles.deletedAt)))
    const count = bindings[0]?.count ?? 0
    if (count > 0) {
      throw new ConflictException(`该权限仍被 ${count} 个角色引用，无法删除`)
    }

    // L18：软删与清绑定同事务——FK 引用不了部分唯一索引（软删允许同码重建的设计），
    // 改用与角色删除同款模式：软删权限时同步清理全部绑定（含已删角色的幽灵行），
    // 否则残留绑定在权限恢复时"复活"旧授权
    await db.transaction(async (tx) => {
      await tx.update(permissions).set({ deletedAt: new Date() }).where(eq(permissions.id, id))
      await tx.delete(rolePermissions).where(eq(rolePermissions.permission, existing.code))
    })
    this.invalidateRolePermissionCache()

    return { message: `权限 ID ${id} 已删除` }
  }

  async restore(id: number): Promise<Permission> {
    const existing = await db.query.permissions.findFirst({
      where: eq(permissions.id, id),
    })
    if (!existing) {
      throw new NotFoundException(`权限 ID ${id} 不存在`)
    }

    if (!existing.deletedAt) {
      throw new ConflictException('权限未被删除，无需恢复')
    }

    // 恢复前校验 code 唯一
    const duplicate = await db.query.permissions.findFirst({
      where: and(eq(permissions.code, existing.code), notDeleted(permissions.deletedAt)),
    })
    if (duplicate) {
      throw new ConflictException('权限码已被其他权限使用，无法恢复')
    }

    try {
      const [restored] = await db
        .update(permissions)
        .set({ deletedAt: null })
        .where(eq(permissions.id, id))
        .returning()

      if (!restored) {
        throw new ConflictException('恢复权限失败')
      }
      this.invalidateRolePermissionCache()

      return restored
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('权限码已存在（并发冲突）')
      }
      throw error
    }
  }
}
