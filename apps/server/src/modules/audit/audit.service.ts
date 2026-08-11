import { Injectable, NotFoundException } from '@nestjs/common'
import type { AuditLog } from '@shared/schemas/audit'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { auditLogs, users } from '@/db/schema'

export interface RecordAuditLogParams {
  userId: number
  action: string
  resource: string
  resourceId?: number
  oldValue?: Record<string, unknown>
  newValue?: Record<string, unknown>
  ip?: string
  userAgent?: string
}

export interface AuditFilter {
  userId?: number
  action?: string
  resource?: string
  keyword?: string
}

@Injectable()
export class AuditService {
  async record(params: RecordAuditLogParams): Promise<void> {
    await db.insert(auditLogs).values({
      userId: params.userId,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      oldValue: params.oldValue,
      newValue: params.newValue,
      ip: params.ip,
      userAgent: params.userAgent,
    })
  }

  async findAll(
    page = 1,
    pageSize = 10,
    filter?: AuditFilter,
  ): Promise<PaginatedResponse<AuditLog>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize

    const conditions = []
    if (filter?.userId) {
      conditions.push(eq(auditLogs.userId, filter.userId))
    }
    if (filter?.action) {
      conditions.push(eq(auditLogs.action, filter.action))
    }
    if (filter?.resource) {
      conditions.push(eq(auditLogs.resource, filter.resource))
    }
    if (filter?.keyword) {
      // 转义 LIKE 通配符及转义符自身，避免用户输入 \ % _ 破坏匹配
      const escaped = filter.keyword.replace(/[%_\\]/g, '\\$&')
      // 显式加括号包裹 OR，避免 AND 优先级高于 OR 导致 keyword 绕过 userId/action 等过滤
      conditions.push(
        sql`(${users.username} LIKE ${`%${escaped}%`} ESCAPE '\\' OR ${auditLogs.resource} LIKE ${`%${escaped}%`} ESCAPE '\\')`,
      )
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [items, countResult] = await Promise.all([
      db
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          username: users.username,
          action: auditLogs.action,
          resource: auditLogs.resource,
          resourceId: auditLogs.resourceId,
          oldValue: auditLogs.oldValue,
          newValue: auditLogs.newValue,
          ip: auditLogs.ip,
          userAgent: auditLogs.userAgent,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(where)
        .limit(safePageSize)
        .offset(offset)
        .orderBy(desc(auditLogs.createdAt)),
      db
        .select({ value: count() })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(where),
    ])

    const total = countResult[0]?.value ?? 0
    return {
      list: items,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize) || 1,
    }
  }

  async findById(id: number): Promise<AuditLog> {
    const log = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        username: users.username,
        action: auditLogs.action,
        resource: auditLogs.resource,
        resourceId: auditLogs.resourceId,
        oldValue: auditLogs.oldValue,
        newValue: auditLogs.newValue,
        ip: auditLogs.ip,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(eq(auditLogs.id, id))
      .limit(1)

    if (log.length === 0) {
      throw new NotFoundException(`审计日志 ID ${id} 不存在`)
    }
    return log[0] as AuditLog
  }
}
