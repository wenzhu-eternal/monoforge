import { Injectable, NotFoundException } from '@nestjs/common'
import type { AuditLog } from '@shared/schemas/audit'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { appendErrorLog } from '@/common/logger'
import { normalizeIpForKey } from '@/common/utils/ip-normalize'
import { db } from '@/db'
import { auditLogs, users } from '@/db/schema'
import { RedisService } from '@/modules/redis/redis.service'

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

// M1：审计日志分钟级封顶——匿名端（userId=0）用更低上限防灌水稀释
const AUDIT_RECORD_LIMIT_AUTH = 40
const AUDIT_RECORD_LIMIT_ANON = 10

@Injectable()
export class AuditService {
  constructor(private readonly redisService: RedisService) {}

  async record(params: RecordAuditLogParams): Promise<void> {
    // M1：按来源（用户/IP）分钟级封顶，超限丢弃避免 audit_logs 被灌成百万级行
    const allowed = await this.enforceRecordMinuteCap(params.userId, params.ip)
    if (!allowed) {
      // L5：丢弃必须留痕——封顶静默 return 会让审计页"看起来完整"实已缺行，
      // 只有超限瞬间的文件告警能事后解释缺口
      appendErrorLog(
        `[Audit] 审计分钟封顶丢弃: user=${params.userId} action=${params.action} resource=${params.resource}`,
      )
      return
    }

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

  /**
   * M1：审计记录分钟级封顶——单 Lua 脚本原子 INCR+EXPIRE，Redis 故障降级放行。
   * 键设计：已认证按 userId、匿名按 IP 归一（折叠数字段防 key 爆炸）
   */
  private async enforceRecordMinuteCap(userId: number, ip?: string): Promise<boolean> {
    try {
      const minute = new Date().toISOString().slice(0, 16)
      const isAuth = userId > 0
      const key = isAuth
        ? `audit:record:user:${userId}:${minute}`
        : `audit:record:ip:${normalizeIpForKey(ip)}:${minute}`
      const limit = isAuth ? AUDIT_RECORD_LIMIT_AUTH : AUDIT_RECORD_LIMIT_ANON
      // Lua：INCR + 首次 SET EXPIRE 原子，避免进程崩溃后 key 永驻
      const n = (await this.redisService.eval(
        `local n = redis.call('INCR', KEYS[1])
         if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return n`,
        [key],
        [String(120)],
      )) as number
      return n <= limit
    } catch {
      // Redis 故障降级放行（宁多记不漏记）
      return true
    }
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
    // L24：userId 0（匿名哨兵）可过滤——原 truthy 判断使 0 永不可查
    if (filter?.userId !== undefined) {
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
