import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import * as argon2 from 'argon2'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, notDeleted } from '@/db/helpers'
import type { User } from '@/db/schema'
import { roles, users } from '@/db/schema'
import { Cacheable } from '@/modules/cache/cache.decorator'
import { CacheService } from '@/modules/cache/cache.service'

export interface PaginatedUsers {
  list: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

@Injectable()
export class UsersService {
  constructor(private readonly cacheService: CacheService) {}

  async findAll(page = 1, pageSize = 10): Promise<PaginatedUsers> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize

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
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          roleName: roles.name,
        })
        .from(users)
        .leftJoin(roles, eq(users.roleId, roles.id))
        .where(notDeleted(users.deletedAt))
        .limit(safePageSize)
        .offset(offset)
        .orderBy(desc(users.createdAt)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(notDeleted(users.deletedAt)),
    ])

    const total = countResult[0]?.count ?? 0
    const list = items.map((item) => {
      const { ...rest } = item
      // 如果有角色信息，添加到 roles 数组
      if (item.roleName) {
        return { ...rest, roles: [{ id: item.roleId, name: item.roleName }] }
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

  async getStats(): Promise<{ totalUsers: number; activeUsers: number }> {
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

  @Cacheable('user:id', 300)
  async findById(id: number): Promise<Omit<User, 'password'>> {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, id), notDeleted(users.deletedAt)),
    })

    if (!user) {
      throw new NotFoundException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    const { password: _, ...userWithoutPassword } = user
    return userWithoutPassword
  }

  async create(data: {
    username: string
    email: string
    password: string
    nickname?: string
    phone?: string
    roleId?: number | null
  }): Promise<Omit<User, 'password'>> {
    const existingUsername = await db.query.users.findFirst({
      where: and(eq(users.username, data.username), notDeleted(users.deletedAt)),
    })

    if (existingUsername) {
      throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
    }

    const existingEmail = await db.query.users.findFirst({
      where: and(eq(users.email, data.email), notDeleted(users.deletedAt)),
    })

    if (existingEmail) {
      throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
    }

    const hashedPassword = await argon2.hash(data.password)

    try {
      const [newUser] = await db
        .insert(users)
        .values({
          ...data,
          password: hashedPassword,
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
        throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
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
  ): Promise<Omit<User, 'password'>> {
    const existingUser = await db.query.users.findFirst({
      where: and(eq(users.id, id), notDeleted(users.deletedAt)),
    })

    if (!existingUser) {
      throw new NotFoundException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    // email 唯一性校验（排除自身，仅查未软删用户）
    if (data.email && data.email !== existingUser.email) {
      const duplicateEmail = await db.query.users.findFirst({
        where: and(eq(users.email, data.email), notDeleted(users.deletedAt)),
      })
      if (duplicateEmail) {
        throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
      }
    }

    const { password: rawPassword, ...rest } = data
    const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (rawPassword) {
      updateData.password = await argon2.hash(rawPassword)
    }

    try {
      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, id))
        .returning()

      if (!updatedUser) {
        throw new NotFoundException(ErrorMessages[ErrorCodes.OPERATION_FAILED])
      }

      const { password: _, ...userWithoutPassword } = updatedUser
      return userWithoutPassword
    } catch (error) {
      // TOCTOU 兜底: 并发场景下 email 唯一约束冲突转 409
      if (isUniqueViolation(error)) {
        throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
      }
      throw error
    } finally {
      // 更新后清缓存（按 pattern 删除该用户的所有缓存变体）
      await this.cacheService.delByPattern(`cache:user:*${id}*`)
    }
  }

  async remove(id: number): Promise<{ message: string }> {
    const existingUser = await db.query.users.findFirst({
      where: and(eq(users.id, id), notDeleted(users.deletedAt)),
    })

    if (!existingUser) {
      throw new NotFoundException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    // 保护初始管理员账号
    if (existingUser.username === 'admin') {
      throw new ConflictException(ErrorMessages[ErrorCodes.INITIAL_ADMIN_CANNOT_DELETE])
    }

    // 软删除: 设置 deletedAt 时间戳
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id))

    // 删除后清缓存
    await this.cacheService.delByPattern(`cache:user:*${id}*`)

    return { message: `用户 ID ${id} 已删除` }
  }
}
