import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import type { Role } from '@shared/schemas/role'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getEnv } from '@/config/env'
import { db } from '@/db'
import { isUniqueViolation, maybeDeleted, notDeleted } from '@/db/helpers'
import { rolePermissions, roles, users } from '@/db/schema'
import { RedisService } from '@/modules/redis/redis.service'

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name)

  constructor(private readonly redisService: RedisService) {}

  /**
   * L4：删除/恢复角色后失效权限缓存——PermissionsGuard 先查 perm:role:{id}，
   * 不失效会让恢复后的角色在 ≤300s 内继续下发软删前的旧权限码。
   */
  private invalidatePermissionCache(roleId: number): void {
    void this.redisService
      .del(`perm:role:${roleId}`)
      .catch((err) => this.logger.warn(`角色权限缓存失效失败: ${err}`))
  }

  /**
   * L2：内置角色按 id 判定（与 isAdminUser 同源）——按 name 判定时超管合法改名后
   * 该角色失全部保护，且 seed/setup 复活逻辑找不到原行会新建→id 漂移→fail-fast。
   * 环境变量在启动时已校验，ADMIN_ROLE_ID 与 DEFAULT_USER_ROLE_ID 互不相同
   */
  private isBuiltinRole(roleId: number): boolean {
    const env = getEnv()
    return roleId === env.ADMIN_ROLE_ID || roleId === env.DEFAULT_USER_ROLE_ID
  }

  async findAll(page = 1, pageSize = 10, includeDeleted = false): Promise<PaginatedResponse<Role>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize
    const deletedFilter = maybeDeleted(roles.deletedAt, includeDeleted)

    const [items, countResult] = await Promise.all([
      db.query.roles.findMany({
        where: and(deletedFilter),
        limit: safePageSize,
        offset,
        orderBy: [desc(roles.createdAt)],
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(roles).where(and(deletedFilter)),
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

  async findById(id: number, includeDeleted = false): Promise<Role> {
    const deletedFilter = maybeDeleted(roles.deletedAt, includeDeleted)
    const role = await db.query.roles.findFirst({
      where: and(eq(roles.id, id), deletedFilter),
    })
    if (!role) {
      throw new NotFoundException(`角色 ID ${id} 不存在`)
    }
    return role
  }

  async create(data: { name: string; description?: string | null }): Promise<Role> {
    // L4：拒绝创建内置角色名（admin/user），防公开注册/默认建户/微信建户断裂
    if (['admin', 'user'].includes(data.name)) {
      throw new ForbiddenException('系统内置角色名不可用')
    }
    const existing = await db.query.roles.findFirst({
      where: and(eq(roles.name, data.name), notDeleted(roles.deletedAt)),
    })
    if (existing) {
      throw new ConflictException('角色名已存在')
    }

    try {
      const [created] = await db.insert(roles).values(data).returning()
      if (!created) {
        throw new ConflictException('创建角色失败')
      }
      return created
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('角色名已存在')
      }
      throw error
    }
  }

  async update(
    id: number,
    data: { name?: string; description?: string | null },
    callerIsAdmin: boolean = false,
  ): Promise<Role> {
    const existing = await db.query.roles.findFirst({
      where: and(eq(roles.id, id), notDeleted(roles.deletedAt)),
    })
    if (!existing) {
      throw new NotFoundException(`角色 ID ${id} 不存在`)
    }

    // L6/L7：目标名入向封禁内置名，但超管可把内置角色按 id 改回原名
    // （内置角色可能先被改成其他名字，仅凭 name 无法识别其身份）
    if (data.name && data.name !== existing.name && ['admin', 'user'].includes(data.name)) {
      const builtinRoleId =
        data.name === 'admin' ? getEnv().ADMIN_ROLE_ID : getEnv().DEFAULT_USER_ROLE_ID
      if (!callerIsAdmin || id !== builtinRoleId) {
        throw new ForbiddenException('系统内置角色名不可用')
      }
    }

    if (data.name && data.name !== existing.name) {
      // L2：seeded 内置角色改名仅限超管，防公开注册/默认建户/微信建户硬依赖断裂；
      // 按 id 判定，避免角色被合法改名后 name 检查失效
      if (this.isBuiltinRole(id) && !callerIsAdmin) {
        throw new ForbiddenException('系统内置角色名仅超级管理员可改')
      }
      const dup = await db.query.roles.findFirst({
        where: and(eq(roles.name, data.name), notDeleted(roles.deletedAt)),
      })
      if (dup) {
        throw new ConflictException('角色名已存在')
      }
    }

    const [updated] = await db
      .update(roles)
      .set({ ...data, updatedAt: new Date() })
      // P2-5：与 users.update 同口径，并发软删行不再误更新
      .where(and(eq(roles.id, id), notDeleted(roles.deletedAt)))
      .returning()
      .catch((error: unknown) => {
        // M9：并发改名撞唯一索引时转 409（预检 dup 后仍有竞态窗口）
        if (isUniqueViolation(error)) {
          throw new ConflictException('角色名已存在（并发冲突）')
        }
        throw error
      })

    if (!updated) {
      throw new NotFoundException(`更新角色 ID ${id} 失败`)
    }
    return updated
  }

  async remove(id: number): Promise<{ message: string }> {
    const existing = await db.query.roles.findFirst({
      where: and(eq(roles.id, id), notDeleted(roles.deletedAt)),
    })
    if (!existing) {
      throw new NotFoundException(`角色 ID ${id} 不存在`)
    }

    // L2：内置角色（按 id）是超管判定与默认建户的硬依赖，禁止软删——
    // 按 name 判定会在超管合法改名后失锁（无用户绑定时可被软删，seed 复活即 id 漂移）
    if (this.isBuiltinRole(id)) {
      throw new ForbiddenException('系统内置角色不可删除')
    }

    // 绑定校验: 检查是否被用户引用
    const userCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.roleId, id), notDeleted(users.deletedAt)))
    const count = userCount[0]?.count ?? 0
    if (count > 0) {
      throw new ConflictException(
        `${ErrorMessages[ErrorCodes.ROLE_IN_USE]}（仍被 ${count} 个用户使用）`,
      )
    }

    // L2：软删与清绑定必须同事务——中途失败会留下"角色已软删但绑定残留"，
    // 重试因 notDeleted 预检 404 而孤儿绑定永难清理
    await db.transaction(async (tx) => {
      await tx.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, id))

      // L11：软删角色同步清绑定——残留绑定会让权限删除校验计入幽灵引用（角色列表已删、权限却删不掉）；
      // 恢复角色后由管理员重新授权，不自动复活旧绑定
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id))
    })

    this.invalidatePermissionCache(id)
    return { message: `角色 ID ${id} 已删除` }
  }

  async restore(id: number): Promise<Role> {
    const existing = await db.query.roles.findFirst({
      where: eq(roles.id, id),
    })
    if (!existing) {
      throw new NotFoundException(`角色 ID ${id} 不存在`)
    }

    if (!existing.deletedAt) {
      throw new ConflictException('角色未被删除，无需恢复')
    }

    // 恢复前校验 name 唯一
    const duplicate = await db.query.roles.findFirst({
      where: and(eq(roles.name, existing.name), notDeleted(roles.deletedAt)),
    })
    if (duplicate) {
      throw new ConflictException('角色名已被其他角色使用，无法恢复')
    }

    try {
      const [restored] = await db
        .update(roles)
        .set({ deletedAt: null })
        .where(eq(roles.id, id))
        .returning()

      if (!restored) {
        throw new ConflictException('恢复角色失败')
      }

      this.invalidatePermissionCache(id)
      return restored
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('角色名已存在（并发冲突）')
      }
      throw error
    }
  }
}
