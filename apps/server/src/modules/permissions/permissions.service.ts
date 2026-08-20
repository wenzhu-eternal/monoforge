import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import type { Permission } from '@shared/schemas/permission'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, maybeDeleted, notDeleted } from '@/db/helpers'
import { permissions, rolePermissions } from '@/db/schema'
import { RedisService } from '@/modules/redis/redis.service'

@Injectable()
export class PermissionsService {
  constructor(private readonly redisService: RedisService) {}

  // 权限码变更（改名/软删/恢复）会影响所有引用该码的角色缓存，统一失效
  private invalidateRolePermissionCache(): void {
    void this.redisService.deleteByPattern('perm:role:*')
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

  async create(data: {
    code: string
    name: string
    description?: string
    routes?: string[]
  }): Promise<Permission> {
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
  ): Promise<Permission> {
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
    // 不同步则旧绑定成为孤儿记录，innerJoin 匹配不到，引用角色会静默失去该权限
    let updated: Permission | undefined
    if (data.code && data.code !== existing.code) {
      updated = await db.transaction(async (tx) => {
        await tx
          .update(rolePermissions)
          .set({ permission: data.code as string })
          .where(eq(rolePermissions.permission, existing.code))
        const [row] = await tx
          .update(permissions)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(permissions.id, id))
          .returning()
        return row
      })
    } else {
      const [row] = await db
        .update(permissions)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(permissions.id, id))
        .returning()
      updated = row
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

    // 绑定校验: 检查是否被角色引用
    const bindings = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rolePermissions)
      .where(eq(rolePermissions.permission, existing.code))
    const count = bindings[0]?.count ?? 0
    if (count > 0) {
      throw new ConflictException(`该权限仍被 ${count} 个角色引用，无法删除`)
    }

    await db.update(permissions).set({ deletedAt: new Date() }).where(eq(permissions.id, id))
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
