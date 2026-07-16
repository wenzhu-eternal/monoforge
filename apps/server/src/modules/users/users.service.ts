import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import type { DashboardStats } from '@shared/schemas/dashboard'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import type { User, UserListItem } from '@shared/schemas/user'
import * as argon2 from 'argon2'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, notDeleted } from '@/db/helpers'
import { files, roles, users } from '@/db/schema'
import { Cacheable } from '@/modules/cache/cache.decorator'
import { CacheService } from '@/modules/cache/cache.service'

@Injectable()
export class UsersService {
  constructor(private readonly cacheService: CacheService) {}

  async findAll(page = 1, pageSize = 10): Promise<PaginatedResponse<UserListItem>> {
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
      throw new ConflictException('用户名已存在，请更换用户名')
    }

    const existingEmail = await db.query.users.findFirst({
      where: and(eq(users.email, data.email), notDeleted(users.deletedAt)),
    })

    if (existingEmail) {
      throw new ConflictException('邮箱已被注册，请更换邮箱')
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
        throw new ConflictException('邮箱已被其他用户使用，请更换邮箱')
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
      // 并发冲突兜底
      if (isUniqueViolation(error)) {
        throw new ConflictException('邮箱已被注册（并发冲突）')
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

    if (existingUser.username === 'admin') {
      throw new ConflictException(ErrorMessages[ErrorCodes.INITIAL_ADMIN_CANNOT_DELETE])
    }

    // 外键引用校验: files.uploadedBy 无级联删除策略，需检查是否有关联文件
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

    await this.cacheService.delByPattern(`cache:user:*${id}*`)

    return { message: `用户 ID ${id} 已删除` }
  }
}
