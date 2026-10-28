import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { ErrorLog, ErrorLogGroup, ErrorStats, ErrorWhitelist } from '@shared/schemas/error-log'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { appendErrorLog } from '@/common/logger'
import { normalizeIpForKey } from '@/common/utils/ip-normalize'
import { db } from '@/db'
import { isUniqueViolation, maybeDeleted, notDeleted } from '@/db/helpers'
import { trackDbWrite } from '@/db/pending-writes'
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

/** 后端内部记录入参（record 专用） */
export interface RecordErrorParams {
  message: string
  stack?: string
  statusCode?: number
  url?: string
  method?: string
  context?: Record<string, unknown>
  userId?: number
  ip?: string
  userAgent?: string
  /** L12：运维补偿/失败留痕，不经白名单（宽 pattern 不得吞掉内部故障证据） */
  internal?: boolean
}

// 活跃白名单子集（isActive=true），供 checkWhitelist 命中匹配使用
const WHITELIST_ACTIVE_CACHE_KEY = 'error:whitelist:active'
// 未删除白名单全集（含 isActive=false），供 findWhitelist 列表展示使用
const WHITELIST_ALL_CACHE_KEY = 'error:whitelist:all:notDeleted'
const WHITELIST_CACHE_TTL = 60

@Injectable()
export class ErrorLogsService {
  constructor(private readonly redisService: RedisService) {}

  async report(
    params: ReportErrorParams,
  ): Promise<{ id?: number; skipped?: boolean; reason?: string }> {
    const isWhitelisted = await this.checkWhitelist(params.message, params.url)
    if (isWhitelisted) {
      return { skipped: true, reason: 'whitelisted' }
    }

    // 按 IP 限制每日上报条数，防止公开接口撑大数据库
    if (params.ip) {
      await this.enforceDailyIpLimit(params.ip)
    }

    return this.insertLog(params)
  }

  /**
   * 后端内部记录错误（供 ExceptionFilter 等调用）
   * 与公开 report() 分桶：后端异常不走 IP 日限额——若共用配额，攻击者可先打满
   * 自身 IP 配额，使后续真实攻击触发的后端 5xx 日志被拒（审计消音）。
   * N1：4xx（扫描/过期 token/限流）按端点分钟级封顶 20 条，防限流器反成 DB 写入放大器
   * 关闭排空：该方法多为 fire-and-forget 调用，需登记到 pending-writes，
   * 由 DatabaseModule 在 client.end() 前 drain，避免 CONNECTION_ENDED 假告警
   */
  record(params: RecordErrorParams): Promise<void> {
    return trackDbWrite(this.recordInternal(params))
  }

  private async recordInternal(params: RecordErrorParams): Promise<void> {
    // M2：401/403/429 属于安全事件（认证/授权/限流），白名单只能降噪 5xx 与业务报错；
    // 否则持 error_log:manage 的委托管理员可用 pattern="权限不足" 整批吞掉越权探测日志
    // L27：5xx 同样是取证签名——原 message 规则仍可覆盖后端崩溃/越权探测堆栈，
    // 持 error_log:manage 者可预置宽 pattern 掩盖非认证类崩溃证据，故一并豁免 message 白名单
    const isServerError = params.statusCode !== undefined && params.statusCode >= 500
    const skipWhitelist =
      params.internal === true ||
      isServerError ||
      params.statusCode === 401 ||
      params.statusCode === 403 ||
      params.statusCode === 429
    if (!skipWhitelist) {
      // L12：url 白名单仅对前端上报（source=frontend）生效——后端 5xx 是越权探测触发的堆栈证据，
      // 持 error_log:manage 者预置 url 规则不得吞掉；后端仅保留 message 规则降噪
      const isWhitelisted = await this.checkWhitelist(params.message)
      if (isWhitelisted) return
    }

    if (params.statusCode) {
      const is5xx = params.statusCode >= 500
      const allowed = await this.enforceRecordMinuteCap(
        params.statusCode,
        params.url,
        params.userId,
        params.ip,
        is5xx ? 200 : 20,
      )
      if (!allowed) {
        // L5：丢弃必须留痕——静默 return 后无法事后解释该端点该分钟的缺口
        appendErrorLog(
          `[ErrorLogs] ${is5xx ? '5xx' : '4xx'} 分钟封顶丢弃: status=${params.statusCode} url=${params.url ?? 'unknown'}`,
        )
        return
      }
    }

    // L12：internal 仅用于白名单豁免判断，不能透传进 DB 行
    const { internal: _internal, ...logParams } = params
    await this.insertLog({
      source: 'backend',
      errorType: 'http_error',
      ...logParams,
    })
  }

  /**
   * record() 分钟级封顶：key=状态码+端点路径+来源+分钟，超 20 条丢弃。
   * Redis 故障降级放行（宁可多记不漏记）。
   */
  private async enforceRecordMinuteCap(
    statusCode: number,
    url?: string,
    userId?: number,
    ip?: string,
    threshold: number = 20,
  ): Promise<boolean> {
    try {
      // L7：单 Lua 脚本原子 INCR+EXPIRE，避免两步之间进程崩溃导致 key 永驻
      // P2-6：数字段折叠为 :id，避免 /users/1…/99999 打爆 key 空间
      const path = ((url ?? 'unknown').split('?')[0] ?? 'unknown').replace(/\d+/g, ':id')
      // M6：来源维度入键——原键按 (statusCode, path) 全局共享、无来源，已认证低权攻击者
      // 先对目标端点刷 20 次烧干本分钟预算，随后同端点的越权探测第 21 条起静默丢弃且
      // 4xx 无 IP 维度无法事后归因。来源入键后各用户/IP 独立计数，攻击者烧穿不影响取证。
      // 已认证按 userId（精确），匿名按归一 IP（/24 网段，复用 M5 归一防 key 爆炸）
      const source = userId && userId > 0 ? `u${userId}` : `ip${normalizeIpForKey(ip)}`
      const minute = new Date().toISOString().slice(0, 16)
      const key = `err:record:${statusCode}:${path}:${source}:${minute}`
      const n = (await this.redisService.eval(
        `local n = redis.call('INCR', KEYS[1])
         if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return n`,
        [key],
        ['120'],
      )) as number
      return n <= threshold
    } catch {
      return true
    }
  }

  private async insertLog(
    params: ReportErrorParams,
  ): Promise<{ id?: number; skipped?: boolean; reason?: string }> {
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
      return { skipped: true, reason: 'insert_failed' }
    }

    return { id: created.id }
  }

  async findAll(
    page = 1,
    pageSize = 10,
    keyword?: string,
    source?: string,
    isResolved?: boolean,
    includeDeleted = false,
  ): Promise<PaginatedResponse<ErrorLog>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize

    const deletedFilter = maybeDeleted(errorLogs.deletedAt, includeDeleted)
    const conditions = [deletedFilter]
    if (keyword) {
      // 转义 LIKE 通配符及转义符自身，避免用户输入 \ % _ 破坏匹配
      const escaped = keyword.replace(/[%_\\]/g, '\\$&')
      conditions.push(sql`${errorLogs.message} ILIKE ${`%${escaped}%`} ESCAPE '\\'`)
    }
    if (source) {
      conditions.push(eq(errorLogs.source, source))
    }
    if (isResolved !== undefined) {
      conditions.push(eq(errorLogs.isResolved, isResolved))
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
      list: items as ErrorLog[],
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

  // 按 IP 限制每日错误上报最多 100 条
  // Lua 保证 INCR + 首次 EXPIRE 原子：两步分离时进程中断会导致 key 无 TTL 永驻，该 IP 永久限流
  // L12：入键前统一 normalizeIpForKey，与 audit/4xx 封顶口径一致，避免 IPv6 /64 旋转逐地址立桶
  private async enforceDailyIpLimit(ip: string): Promise<void> {
    const key = `error:report:day:${normalizeIpForKey(ip)}`
    try {
      const now = new Date()
      const secondsUntilMidnight =
        (24 - now.getHours()) * 3600 - now.getMinutes() * 60 - now.getSeconds()
      const count = (await this.redisService.eval(
        `local n = redis.call('INCR', KEYS[1])
         if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return n`,
        [key],
        [Math.max(secondsUntilMidnight, 60)],
      )) as number
      if (count > 100) {
        throw new ConflictException('该 IP 今日错误上报已达上限')
      }
    } catch (err) {
      if (err instanceof ConflictException) throw err
      // Redis 异常时降级放行，避免阻塞主流程
    }
  }

  private async checkWhitelist(message: string, url?: string): Promise<boolean> {
    try {
      const cached = await this.redisService.get(WHITELIST_ACTIVE_CACHE_KEY)
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

    // L3：空列表也缓存 "[]"——活跃白名单为空时若跳过缓存，公开上报路径每次都打穿 DB，
    // 高频报错下查询 QPS 与上报同阶放大
    try {
      await this.redisService.set(
        WHITELIST_ACTIVE_CACHE_KEY,
        JSON.stringify(list),
        WHITELIST_CACHE_TTL,
      )
    } catch {
      // 回填失败不影响本次匹配，下次仍走查库
    }

    return this.matchWhitelist(list, message, url)
  }

  private matchWhitelist(
    list: Array<{ pattern: string; matchType: string; isActive?: boolean }>,
    message: string,
    url?: string,
  ): boolean {
    for (const rule of list) {
      if (rule.isActive === false) continue
      if (rule.matchType === 'message' && message.includes(rule.pattern)) {
        return true
      }
      if (rule.matchType === 'url' && url?.includes(rule.pattern)) {
        return true
      }
    }
    return false
  }

  async findWhitelist(includeDeleted = false): Promise<ErrorWhitelist[]> {
    if (includeDeleted) {
      const list = await db
        .select()
        .from(errorWhitelist)
        .orderBy(desc(errorWhitelist.createdAt), desc(errorWhitelist.id))
      return list as ErrorWhitelist[]
    }

    try {
      const cached = await this.redisService.get(WHITELIST_ALL_CACHE_KEY)
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
      await this.redisService.set(
        WHITELIST_ALL_CACHE_KEY,
        JSON.stringify(list),
        WHITELIST_CACHE_TTL,
      )
    } catch {}

    return list as ErrorWhitelist[]
  }

  async createWhitelist(data: {
    pattern: string
    matchType?: string
    description?: string
    isActive?: boolean
  }): Promise<ErrorWhitelist> {
    // M9：并发撞 (match_type, pattern) 唯一索引时转 409（原直接 500）
    try {
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
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('白名单规则已存在')
      }
      throw error
    }
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
      .catch((error: unknown) => {
        // M9：并发改到相同规则时转 409
        if (isUniqueViolation(error)) {
          throw new ConflictException('白名单规则已存在')
        }
        throw error
      })

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

  async restoreWhitelist(id: number): Promise<ErrorWhitelist> {
    const existing = await db.query.errorWhitelist.findFirst({
      where: eq(errorWhitelist.id, id),
    })
    if (!existing) {
      throw new NotFoundException(`白名单 ID ${id} 不存在`)
    }

    if (!existing.deletedAt) {
      throw new ConflictException('白名单未被删除，无需恢复')
    }

    const [restored] = await db
      .update(errorWhitelist)
      .set({ deletedAt: null })
      .where(eq(errorWhitelist.id, id))
      .returning()
      .catch((error: unknown) => {
        // M9：恢复时已有同规则生效记录，转 409
        if (isUniqueViolation(error)) {
          throw new ConflictException('白名单规则已存在，无法恢复')
        }
        throw error
      })

    if (!restored) {
      throw new NotFoundException('恢复白名单失败')
    }

    await this.invalidateWhitelistCache()
    return restored as ErrorWhitelist
  }

  private async invalidateWhitelistCache(): Promise<void> {
    try {
      await this.redisService.del(WHITELIST_ACTIVE_CACHE_KEY)
      await this.redisService.del(WHITELIST_ALL_CACHE_KEY)
    } catch {
      // 缓存失效失败忽略，等待 TTL 过期
    }
  }
}
