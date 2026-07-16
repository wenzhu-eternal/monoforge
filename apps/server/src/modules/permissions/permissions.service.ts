import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import type { Permission } from '@shared/schemas/permission'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, notDeleted } from '@/db/helpers'
import { permissions, rolePermissions } from '@/db/schema'

@Injectable()
export class PermissionsService {
  async findAll(page = 1, pageSize = 10): Promise<PaginatedResponse<Permission>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize

    const [items, countResult] = await Promise.all([
      db.query.permissions.findMany({
        where: notDeleted(permissions.deletedAt),
        limit: safePageSize,
        offset,
        orderBy: [desc(permissions.createdAt)],
      }),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(permissions)
        .where(notDeleted(permissions.deletedAt)),
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

  async findById(id: number): Promise<Permission> {
    const permission = await db.query.permissions.findFirst({
      where: and(eq(permissions.id, id), notDeleted(permissions.deletedAt)),
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

    const [updated] = await db
      .update(permissions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(permissions.id, id))
      .returning()

    if (!updated) {
      throw new NotFoundException(`更新权限 ID ${id} 失败`)
    }
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

    // 软删除: 设置 deletedAt 时间戳
    await db.update(permissions).set({ deletedAt: new Date() }).where(eq(permissions.id, id))

    return { message: `权限 ID ${id} 已删除` }
  }
}
