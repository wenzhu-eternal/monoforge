import { Injectable, NotFoundException } from '@nestjs/common'
import type { ErrorLog, ErrorLogGroup, ErrorStats, ErrorWhitelist } from '@shared/schemas/error-log'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import { and, count, desc, eq, ilike, sql } from 'drizzle-orm'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { errorLogs } from '@/db/schema'
import { errorWhitelist } from '@/db/schema/error-whitelist'
import { RedisService } from '@/modules/redis/redis.service'

export interface ReportErrorParams {
  source?: string
  errorType?: string
  message: string
  stack?: string
  file?: string
  line?: number
  column?: number
  url?: string
  method?: string
  statusCode?: number
  context?: Record<string, unknown>
  userId?: number
  ip?: string
  userAgent?: string
}

const WHITELIST_CACHE_KEY = 'error:whitelist:all'
const WHITELIST_CACHE_TTL = 60

@Injectable()
export class ErrorLogsService {
  constructor(private readonly redisService: RedisService) {}

  async report(params: ReportErrorParams): Promise<{ id: number }> {
    // 白名单过滤
    const isWhitelisted = await this.checkWhitelist(params.message, params.url)
    if (isWhitelisted) {
      return { id: -1 }
    }

    const [created] = await db
      .insert(errorLogs)
      .values({
        source: params.source ?? 'backend',
        errorType: params.errorType,
        message: params.message,
        stack: params.stack,
        file: params.file,
        line: params.line,
        column: params.column,
        url: params.url,
        method: params.method,
        statusCode: params.statusCode,
        context: params.context,
        userId: params.userId,
        ip: params.ip,
        userAgent: params.userAgent,
      })
      .returning()

    if (!created) {
      return { id: -1 }
    }

    return { id: created.id }
  }

  /**
   * 后端内部记录错误（供 ExceptionFilter 等调用）
   */
  async record(params: {
    message: string
    stack?: string
    context?: Record<string, unknown>
    userId?: number
    ip?: string
    userAgent?: string
  }): Promise<void> {
    await this.report({
      source: 'backend',
      errorType: 'http_error',
      message: params.message,
      stack: params.stack,
      context: params.context,
      userId: params.userId,
      ip: params.ip,
      userAgent: params.userAgent,
    })
  }

  async findAll(
    page = 1,
    pageSize = 10,
    keyword?: string,
    source?: string,
    isResolved?: string,
  ): Promise<PaginatedResponse<ErrorLog>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize

    const conditions = [notDeleted(errorLogs.deletedAt)]
    if (keyword) {
      conditions.push(ilike(errorLogs.message, `%${keyword}%`))
    }
    if (source) {
      conditions.push(eq(errorLogs.source, source))
    }
    if (isResolved !== undefined) {
      conditions.push(eq(errorLogs.isResolved, isResolved === 'true'))
    }
    const where = and(...conditions)

    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(errorLogs)
        .where(where)
        .orderBy(desc(errorLogs.createdAt))
        .limit(safePageSize)
        .offset(offset),
      db.select({ value: count() }).from(errorLogs).where(where),
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

  async findById(id: number): Promise<ErrorLog> {
    const log = await db.query.errorLogs.findFirst({
      where: and(eq(errorLogs.id, id), notDeleted(errorLogs.deletedAt)),
    })
    if (!log) {
      throw new NotFoundException(`错误日志 ID ${id} 不存在`)
    }
    return log as ErrorLog
  }

  async findGrouped(limit = 10): Promise<ErrorLogGroup[]> {
    const safeLimit = Math.min(Math.max(1, limit), 50)

    const groups = await db
      .select({
        message: errorLogs.message,
        source: errorLogs.source,
        count: sql<number>`count(*)::int`,
        lastCreatedAt: sql<Date>`max(${errorLogs.createdAt})`,
        firstCreatedAt: sql<Date>`min(${errorLogs.createdAt})`,
        sampleId: sql<number>`(array_agg(${errorLogs.id} ORDER BY ${errorLogs.createdAt} DESC))[1]`,
      })
      .from(errorLogs)
      .where(and(eq(errorLogs.isResolved, false), notDeleted(errorLogs.deletedAt)))
      .groupBy(errorLogs.message, errorLogs.source)
      .orderBy(sql`count(*) DESC`)
      .limit(safeLimit)

    return groups.map((g) => ({
      message: g.message,
      source: g.source ?? 'unknown',
      count: g.count,
      firstCreatedAt: g.firstCreatedAt,
      lastCreatedAt: g.lastCreatedAt,
      sampleId: g.sampleId,
    }))
  }

  async getStats(): Promise<ErrorStats> {
    const [totalResult] = await db
      .select({ value: count() })
      .from(errorLogs)
      .where(notDeleted(errorLogs.deletedAt))
    const [unresolvedResult] = await db
      .select({ value: count() })
      .from(errorLogs)
      .where(and(eq(errorLogs.isResolved, false), notDeleted(errorLogs.deletedAt)))

    const sourceRows = await db
      .select({ source: errorLogs.source, value: count() })
      .from(errorLogs)
      .where(notDeleted(errorLogs.deletedAt))
      .groupBy(errorLogs.source)

    const typeRows = await db
      .select({ errorType: errorLogs.errorType, value: count() })
      .from(errorLogs)
      .where(notDeleted(errorLogs.deletedAt))
      .groupBy(errorLogs.errorType)

    const bySource: Record<string, number> = {}
    for (const row of sourceRows) {
      bySource[row.source ?? 'unknown'] = row.value
    }

    const byType: Record<string, number> = {}
    for (const row of typeRows) {
      byType[row.errorType ?? 'unknown'] = row.value
    }

    return {
      total: totalResult?.value ?? 0,
      unresolved: unresolvedResult?.value ?? 0,
      bySource,
      byType,
    }
  }

  async resolve(id: number, resolvedBy: number): Promise<{ message: string }> {
    const log = await db.query.errorLogs.findFirst({
      where: and(eq(errorLogs.id, id), notDeleted(errorLogs.deletedAt)),
    })
    if (!log) {
      throw new NotFoundException(`错误日志 ID ${id} 不存在`)
    }

    await db
      .update(errorLogs)
      .set({
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy,
      })
      .where(eq(errorLogs.id, id))

    return { message: `错误日志 ID ${id} 已标记为已处理` }
  }

  /**
   * 批量标记相同报错已处理: 按 message+source 匹配
   */
  async batchResolve(
    message: string,
    source: string,
    resolvedBy: number,
  ): Promise<{ message: string; affected: number }> {
    const result = await db
      .update(errorLogs)
      .set({
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy,
      })
      .where(
        and(
          eq(errorLogs.message, message),
          eq(errorLogs.source, source),
          notDeleted(errorLogs.deletedAt),
        ),
      )
      .returning({ id: errorLogs.id })

    return {
      message: `已批量处理 ${result.length} 条相同错误`,
      affected: result.length,
    }
  }

  async remove(id: number): Promise<{ message: string }> {
    const log = await db.query.errorLogs.findFirst({
      where: and(eq(errorLogs.id, id), notDeleted(errorLogs.deletedAt)),
    })
    if (!log) {
      throw new NotFoundException(`错误日志 ID ${id} 不存在`)
    }

    await db.update(errorLogs).set({ deletedAt: new Date() }).where(eq(errorLogs.id, id))

    return { message: `错误日志 ID ${id} 已删除` }
  }

  private async checkWhitelist(message: string, url?: string): Promise<boolean> {
    try {
      const cached = await this.redisService.get(WHITELIST_CACHE_KEY)
      if (cached) {
        const list = JSON.parse(cached) as Array<{
          pattern: string
          matchType: string
          isActive: boolean
        }>
        return this.matchWhitelist(list, message, url)
      }
    } catch {
      // 缓存查询失败，直接查库
    }

    const list = await db
      .select()
      .from(errorWhitelist)
      .where(and(eq(errorWhitelist.isActive, true), notDeleted(errorWhitelist.deletedAt)))
    return this.matchWhitelist(list, message, url)
  }

  private matchWhitelist(
    list: Array<{ pattern: string; matchType: string }>,
    message: string,
    url?: string,
  ): boolean {
    for (const rule of list) {
      if (rule.matchType === 'message' && message.includes(rule.pattern)) {
        return true
      }
      if (rule.matchType === 'url' && url?.includes(rule.pattern)) {
        return true
      }
    }
    return false
  }

  async findWhitelist(): Promise<ErrorWhitelist[]> {
    try {
      const cached = await this.redisService.get(WHITELIST_CACHE_KEY)
      if (cached) {
        return JSON.parse(cached)
      }
    } catch {
      // 缓存查询失败不影响主流程
    }

    const list = await db
      .select()
      .from(errorWhitelist)
      .where(notDeleted(errorWhitelist.deletedAt))
      .orderBy(desc(errorWhitelist.createdAt), desc(errorWhitelist.id))

    try {
      await this.redisService.set(WHITELIST_CACHE_KEY, JSON.stringify(list), WHITELIST_CACHE_TTL)
    } catch {
      // 缓存写入失败忽略
    }

    return list as ErrorWhitelist[]
  }

  async createWhitelist(data: {
    pattern: string
    matchType?: string
    description?: string
    isActive?: boolean
  }): Promise<ErrorWhitelist> {
    const [created] = await db
      .insert(errorWhitelist)
      .values({
        pattern: data.pattern,
        matchType: (data.matchType as 'message' | 'url') ?? 'message',
        description: data.description,
        isActive: data.isActive ?? true,
      })
      .returning()

    await this.invalidateWhitelistCache()
    return created as ErrorWhitelist
  }

  async updateWhitelist(
    id: number,
    data: {
      pattern?: string
      matchType?: string
      description?: string
      isActive?: boolean
    },
  ): Promise<ErrorWhitelist> {
    const existing = await db.query.errorWhitelist.findFirst({
      where: and(eq(errorWhitelist.id, id), notDeleted(errorWhitelist.deletedAt)),
    })
    if (!existing) {
      throw new NotFoundException(`白名单 ID ${id} 不存在`)
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (data.pattern !== undefined) updateData.pattern = data.pattern
    if (data.matchType !== undefined) updateData.matchType = data.matchType
    if (data.description !== undefined) updateData.description = data.description
    if (data.isActive !== undefined) updateData.isActive = data.isActive

    const [updated] = await db
      .update(errorWhitelist)
      .set(updateData)
      .where(eq(errorWhitelist.id, id))
      .returning()

    if (!updated) {
      throw new NotFoundException(`更新白名单 ID ${id} 失败`)
    }

    await this.invalidateWhitelistCache()
    return updated as ErrorWhitelist
  }

  async removeWhitelist(id: number): Promise<{ message: string }> {
    const existing = await db.query.errorWhitelist.findFirst({
      where: and(eq(errorWhitelist.id, id), notDeleted(errorWhitelist.deletedAt)),
    })
    if (!existing) {
      throw new NotFoundException(`白名单 ID ${id} 不存在`)
    }

    await db.update(errorWhitelist).set({ deletedAt: new Date() }).where(eq(errorWhitelist.id, id))

    await this.invalidateWhitelistCache()
    return { message: `白名单 ID ${id} 已删除` }
  }

  private async invalidateWhitelistCache(): Promise<void> {
    try {
      await this.redisService.del(WHITELIST_CACHE_KEY)
    } catch {
      // 缓存失效失败忽略，等待 TTL 过期
    }
  }
}
