import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import type { DashboardStats } from '@shared/schemas/dashboard'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import type { User, UserListItem } from '@shared/schemas/user'
import * as argon2 from 'argon2'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { isAdminUser } from '@/common/utils/is-admin'
import { getEnv } from '@/config/env'
import { db } from '@/db'
import { isUniqueViolation, maybeDeleted, notDeleted } from '@/db/helpers'
import { files, permissions as permissionsTable, rolePermissions, roles, users } from '@/db/schema'
import { RedisService } from '@/modules/redis/redis.service'

@Injectable()
export class UsersService {
  constructor(private readonly redisService: RedisService) {}

  async findAll(
    page = 1,
    pageSize = 10,
    includeDeleted = false,
  ): Promise<PaginatedResponse<UserListItem>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize
    const deletedFilter = maybeDeleted(users.deletedAt, includeDeleted)

    const [items, countResult] = await Promise.all([
      db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          nickname: users.nickname,
          avatar: users.avatar,
          phone: users.phone,
          roleId: users.roleId,
          status: users.status,
          deletedAt: users.deletedAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          roleName: roles.name,
        })
        .from(users)
        // L6：软删角色不参与关联（原 leftJoin 会残留已删角色名，与角色列表自相矛盾）
        .leftJoin(roles, and(eq(users.roleId, roles.id), isNull(roles.deletedAt)))
        .where(and(deletedFilter))
        .limit(safePageSize)
        .offset(offset)
        .orderBy(desc(users.createdAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(users).where(and(deletedFilter)),
    ])

    const total = countResult[0]?.count ?? 0
    const list = items.map((item) => {
      const { ...rest } = item
      if (item.roleName && item.roleId) {
        return {
          ...rest,
          roles: [{ id: item.roleId, name: item.roleName }],
        }
      }
      return rest
    })

    return {
      list,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize) || 1,
    }
  }

  async getStats(): Promise<DashboardStats> {
    // 使用聚合查询避免全表扫描，正确统计超过 100 人场景
    const [totalResult, activeResult] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(notDeleted(users.deletedAt)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.status, true), notDeleted(users.deletedAt))),
    ])

    return {
      totalUsers: totalResult[0]?.count ?? 0,
      activeUsers: activeResult[0]?.count ?? 0,
    }
  }

  async findById(id: number, includeDeleted = false): Promise<Omit<User, 'password'>> {
    const deletedFilter = maybeDeleted(users.deletedAt, includeDeleted)
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, id), deletedFilter),
    })

    if (!user) {
      throw new NotFoundException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    const { password: _, ...userWithoutPassword } = user
    return userWithoutPassword
  }

  async create(
    data: {
      username: string
      email: string
      password: string
      nickname?: string
      phone?: string
      roleId?: number | null
      mustChangePassword?: boolean
    },
    caller?: { roleId?: number | null },
  ): Promise<Omit<User, 'password'>> {
    const existingUsername = await db.query.users.findFirst({
      where: and(eq(users.username, data.username), notDeleted(users.deletedAt)),
    })

    if (existingUsername) {
      throw new ConflictException('用户名已存在，请更换用户名')
    }

    const existingEmail = await db.query.users.findFirst({
      where: and(eq(users.email, data.email), notDeleted(users.deletedAt)),
    })

    if (existingEmail) {
      throw new ConflictException('邮箱已被注册，请更换邮箱')
    }

    // 未指定角色时默认分配普通 user 角色（controller 已拦截越权指定 roleId 的请求）
    let roleId = data.roleId
    if (!roleId) {
      const defaultRole = await db.query.roles.findFirst({
        where: and(eq(roles.name, 'user'), notDeleted(roles.deletedAt)),
      })
      if (!defaultRole) {
        throw new ConflictException('默认角色不存在，请联系管理员初始化种子数据')
      }
      roleId = defaultRole.id
    } else {
      const role = await db.query.roles.findFirst({
        where: eq(roles.id, roleId),
      })
      if (!role || role.deletedAt) {
        throw new ConflictException('角色不存在或已被禁用')
      }
    }

    // H1：超管角色分配加闸——目标 roleId 为超管时仅超管可授（caller 缺失 fail-closed，
    // 防未来新入口绕过 controller 的 USER_ROLE_MANAGE 检查直接铸造超管）
    if (roleId === getEnv().ADMIN_ROLE_ID && !isAdminUser(caller)) {
      throw new ForbiddenException('仅超级管理员可分配超管角色')
    }

    // M1/J1：显式指定角色时按调用者权限集收敛——目标角色权限码集 ⊆ 调用者权限码集，
    // 与 role-permissions 的"不能授予自身未持有权限"同口径（防借角色分配自我提权）
    if (data.roleId !== undefined) {
      await this.assertRoleWithinCallerScope(roleId, caller)
    }

    const hashedPassword = await argon2.hash(data.password)

    try {
      const [newUser] = await db
        .insert(users)
        .values({
          ...data,
          roleId,
          password: hashedPassword,
          // 管理员建户默认强制首登改密（密码由管理员单方指定）
          mustChangePassword: data.mustChangePassword ?? true,
        })
        .returning()

      if (!newUser) {
        throw new ConflictException(ErrorMessages[ErrorCodes.OPERATION_FAILED])
      }

      const { password: _, ...userWithoutPassword } = newUser
      return userWithoutPassword
    } catch (error) {
      // TOCTOU 兜底: 并发场景下唯一约束冲突转 409
      if (isUniqueViolation(error)) {
        throw new ConflictException('用户名或邮箱已存在（并发冲突）')
      }
      throw error
    }
  }

  async update(
    id: number,
    data: {
      email?: string
      nickname?: string
      avatar?: string
      phone?: string
      status?: boolean
      password?: string
      roleId?: number | null
    },
    caller?: { roleId?: number | null },
  ): Promise<Omit<User, 'password'>> {
    const existingUser = await db.query.users.findFirst({
      where: and(eq(users.id, id), notDeleted(users.deletedAt)),
    })

    if (!existingUser) {
      throw new NotFoundException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    if (data.roleId) {
      const role = await db.query.roles.findFirst({
        where: eq(roles.id, data.roleId),
      })
      if (!role || role.deletedAt) {
        throw new ConflictException('角色不存在或已被禁用')
      }
    }

    // H1：超管保护从"角色变动"扩展为目标是超管时的一切敏感变更——
    // 持 USER_ROLE_MANAGE 的委托管理员若可对超管改 password/status/email，
    // 改密后即可登录超管完成接管（fail-closed，caller 缺失同拒）
    const adminRoleId = getEnv().ADMIN_ROLE_ID
    const touchesAdminRole =
      data.roleId === adminRoleId ||
      (existingUser.roleId === adminRoleId &&
        data.roleId !== undefined &&
        data.roleId !== adminRoleId)
    const editsAdminSensitive =
      existingUser.roleId === adminRoleId &&
      (data.password !== undefined || data.status !== undefined || data.email !== undefined)
    if ((touchesAdminRole || editsAdminSensitive) && !isAdminUser(caller)) {
      throw new ForbiddenException('仅超级管理员可变更超管账号的敏感信息')
    }

    // M1/J1：显式指定角色（含同值提交）时按调用者权限集收敛，口径同 create——
    // 非超管无法对"权限集超出自身"的角色做任何指派动作
    if (data.roleId !== undefined && data.roleId !== null) {
      await this.assertRoleWithinCallerScope(data.roleId, caller)
    }

    // email 唯一性校验（排除自身，仅查未软删用户）
    if (data.email && data.email !== existingUser.email) {
      const duplicateEmail = await db.query.users.findFirst({
        where: and(eq(users.email, data.email), notDeleted(users.deletedAt)),
      })
      if (duplicateEmail) {
        throw new ConflictException('邮箱已被其他用户使用，请更换邮箱')
      }
    }

    const { password: rawPassword, ...rest } = data
    const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (rawPassword) {
      updateData.password = await argon2.hash(rawPassword)
      // L3：经管理端重置密码后强制用户下次改密（与 create 默认 mustChangePassword=true 对齐）
      updateData.mustChangePassword = true
    }

    try {
      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        // L10：带 notDeleted 守卫，并发软删行上不再误更新（落空走 NotFound）
        .where(and(eq(users.id, id), notDeleted(users.deletedAt)))
        .returning()

      if (!updatedUser) {
        throw new NotFoundException(ErrorMessages[ErrorCodes.OPERATION_FAILED])
      }

      // 用户被禁用时吊销所有 refresh + access token，防止封禁用户继续访问
      if (updateData.status === false) {
        await this.redisService.deleteByPattern(`refresh:${id}:*`)
        await this.revokeAccessTokens(id)
      }

      // 角色变更时吊销 access token（用户需用 refresh 重新签发走新角色）+ 失效旧/新角色权限缓存
      if (data.roleId !== undefined && data.roleId !== existingUser.roleId) {
        await this.revokeAccessTokens(id)
        if (existingUser.roleId) {
          await this.redisService.del(`perm:role:${existingUser.roleId}`)
        }
        if (data.roleId) {
          await this.redisService.del(`perm:role:${data.roleId}`)
        }
      }

      // 管理员重置密码后吊销所有 token，强制用户用新密码重新登录（与 changePassword 行为一致）
      if (rawPassword) {
        await this.redisService.deleteByPattern(`refresh:${id}:*`)
        await this.revokeAccessTokens(id)
      }

      const { password: _, ...userWithoutPassword } = updatedUser
      return userWithoutPassword
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('邮箱已被注册（并发冲突）')
      }
      throw error
    }
  }

  /**
   * M1/J1：角色分配按调用者权限集收敛——目标角色权限码集必须 ⊆ 调用者权限码集，
   * 与 role-permissions.service 的防越权授予同口径（users 与 role-permissions 两条
   * 授权路径一致）。超管免检；调用者无角色时集合为空天然 fail-closed；目标角色为
   * 零权限角色不构成提权，放行。
   */
  private async assertRoleWithinCallerScope(
    targetRoleId: number,
    caller?: { roleId?: number | null },
  ): Promise<void> {
    if (isAdminUser(caller)) return

    const targetPerms = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, targetRoleId))
    if (targetPerms.length === 0) return

    const callerPerms = caller?.roleId
      ? await db
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(eq(rolePermissions.roleId, caller.roleId))
      : []
    const callerSet = new Set(callerPerms.map((p) => p.permission))
    if (targetPerms.some((p) => !callerSet.has(p.permission))) {
      throw new ForbiddenException('不能授予超出自身权限范围的角色')
    }
  }

  /**
   * 批量吊销用户活跃 access token：读活跃 jti → 写黑名单 → 清活跃记录
   * 与 AuthService.revokeAllAccessTokens 逻辑一致，内联以避免模块循环依赖
   */
  private async revokeAccessTokens(userId: number): Promise<void> {
    const activeKeys = await this.redisService.scanKeys(`access:active:${userId}:*`)
    if (activeKeys.length === 0) return
    const prefix = `access:active:${userId}:`
    for (const key of activeKeys) {
      const jti = key.slice(prefix.length)
      await this.redisService.set(`access:${userId}:${jti}`, '1', 15 * 60)
    }
    await this.redisService.deleteByPattern(`access:active:${userId}:*`)
  }

  /**
   * 修改自己密码：必须验证旧密码，防止 token 泄露后被改密码锁账号
   */
  async changePassword(
    userId: number,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), notDeleted(users.deletedAt)),
    })
    if (!user) {
      throw new NotFoundException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    const isValid = await argon2.verify(user.password, oldPassword)
    if (!isValid) {
      throw new ConflictException('旧密码不正确')
    }

    const hashedPassword = await argon2.hash(newPassword)
    await db
      .update(users)
      .set({ password: hashedPassword, mustChangePassword: false, updatedAt: new Date() })
      // L10：同 update，并发软删时落空（0 行），后续吊销按无用户处理由调用方 404 前置保证
      .where(and(eq(users.id, userId), notDeleted(users.deletedAt)))

    // 改密后吊销所有 token，强制重新登录
    await this.redisService.deleteByPattern(`refresh:${userId}:*`)
    await this.revokeAccessTokens(userId)

    return { message: '密码修改成功，请重新登录' }
  }

  async hasPermission(userId: number, permissionCode: string): Promise<boolean> {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), notDeleted(users.deletedAt)),
    })
    if (!user?.roleId) return false
    if (isAdminUser(user)) return true

    // 检查 role 是否被软删：role 被软删时该 role 权限不生效
    const role = await db.query.roles.findFirst({
      where: eq(roles.id, user.roleId),
    })
    if (!role || role.deletedAt) return false

    // 与 PermissionsGuard 同口径: innerJoin permissions 过滤已软删的权限码
    const result = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .innerJoin(
        permissionsTable,
        and(
          eq(rolePermissions.permission, permissionsTable.code),
          notDeleted(permissionsTable.deletedAt),
        ),
      )
      .where(eq(rolePermissions.roleId, user.roleId))
    return result.some((p) => p.permission === permissionCode)
  }

  async remove(id: number): Promise<{ message: string }> {
    const existingUser = await db.query.users.findFirst({
      where: and(eq(users.id, id), notDeleted(users.deletedAt)),
    })

    if (!existingUser) {
      throw new NotFoundException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    if (isAdminUser(existingUser)) {
      throw new ConflictException(ErrorMessages[ErrorCodes.INITIAL_ADMIN_CANNOT_DELETE])
    }

    // L7：files.uploadedBy 为 ON DELETE SET NULL（见 schema/files.ts），DB 层不会阻塞删用户；
    // 此处前置检查是为保留文件归属信息，仍有关联文件时拒绝删除，由管理员先迁移归属
    const referencedFiles = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.uploadedBy, id), notDeleted(files.deletedAt)))

    if (referencedFiles.length > 0) {
      throw new ConflictException(
        `用户关联了 ${referencedFiles.length} 个文件，请先删除或转移文件后再删除用户`,
      )
    }

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id))

    // 软删后吊销所有 token，与禁用逻辑保持一致
    await this.redisService.deleteByPattern(`refresh:${id}:*`)
    await this.revokeAccessTokens(id)

    return { message: `用户 ID ${id} 已删除` }
  }

  async restore(id: number): Promise<Omit<User, 'password'>> {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, id),
    })

    if (!existingUser) {
      throw new NotFoundException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    if (!existingUser.deletedAt) {
      throw new ConflictException('用户未被删除，无需恢复')
    }

    const duplicateUsername = await db.query.users.findFirst({
      where: and(eq(users.username, existingUser.username), notDeleted(users.deletedAt)),
    })
    if (duplicateUsername) {
      throw new ConflictException('用户名已被其他用户使用，无法恢复')
    }

    const duplicateEmail = await db.query.users.findFirst({
      where: and(eq(users.email, existingUser.email), notDeleted(users.deletedAt)),
    })
    if (duplicateEmail) {
      throw new ConflictException('邮箱已被其他用户使用，无法恢复')
    }

    // M14：角色删除校验只统计未删用户，软删用户的角色可被先删——不复检会恢复出
    // 绑定已删角色的僵尸用户（getRoleByUserId 永远 403 且前端看不到该角色）
    if (existingUser.roleId !== null) {
      const roleExists = await db.query.roles.findFirst({
        where: and(eq(roles.id, existingUser.roleId), notDeleted(roles.deletedAt)),
      })
      if (!roleExists) {
        throw new ConflictException('用户原角色已被删除，请先为其重新分配角色（或置空角色）')
      }
    }

    try {
      const [restored] = await db
        .update(users)
        .set({ deletedAt: null })
        .where(eq(users.id, id))
        .returning()

      if (!restored) {
        throw new ConflictException(ErrorMessages[ErrorCodes.OPERATION_FAILED])
      }

      const { password: _, ...userWithoutPassword } = restored
      return userWithoutPassword
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('用户名或邮箱已存在（并发冲突）')
      }
      throw error
    }
  }
}
