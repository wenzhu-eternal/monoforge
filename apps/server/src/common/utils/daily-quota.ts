import { ConflictException } from '@nestjs/common'
import { appendErrorLog } from '@/common/logger'
import { noteRedisDegraded, noteRedisRecovered } from '@/common/utils/redis-degradation'
import type { RedisService } from '@/modules/redis/redis.service'

// L4：降级告警每分钟至多一条，防上传高峰时日志线性放大（与限流存储 fail-open 同口径）
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000
let lastFailOpenLogAt = 0

export type QuotaAction = 'backup' | 'upload' | 'notify' | 'userCreate'

export interface DailyQuotaConsume {
  /** 是否实扣（Redis 降级 fail-open 时为 false，调用方不得回滚） */
  consumed: boolean
  /** 扣额时使用的日键；跨零点后回滚必须复用，否则退额落到新日键 */
  key: string
}

/**
 * L6：按用户+动作的日配额（Redis 计数，TTL 到当日 24:00）——
 * 收口 schedule:backup / file:upload 持有者无频控滥用（已授权功能的纵深项）。
 * INCR+EXPIRE 走 Lua 原子（SECURITY.md 限流规范：两步调用在进程中断时会留无 TTL
 * 永驻 key）；超限抛 409
 *
 * L2：返回值携带扣额时刻的日键——rollback 必须用它（默认取当前时刻在跨零点会把
 * 退额记到新日键：旧日白烧、新日被抹 1）
 */
export async function consumeDailyQuota(
  redis: RedisService,
  action: QuotaAction,
  userId: number,
  limit: number,
): Promise<DailyQuotaConsume> {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  const ttl = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 1000))

  const key = quotaKey(action, userId, now)
  let raw: unknown
  try {
    raw = await redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return n`,
      [key],
      [ttl],
    )
  } catch (err) {
    // L4：Redis 故障降级放行（未扣额）——全仓口径为 fail-open（限流/登录锁/审计），
    // 配额是纵深项且上传/备份/通知各有独立管控；fail-closed 会把抖动放大成全量原生 500
    const nowTs = Date.now()
    if (nowTs - lastFailOpenLogAt >= FAIL_OPEN_LOG_INTERVAL_MS) {
      lastFailOpenLogAt = nowTs
      appendErrorLog(
        `[Quota] Redis 配额存储异常，本次 ${action} 未扣额放行: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    // Q3：返回 consumed=false 标记未实扣，调用方据此决定是否回滚——否则降级放行的 A 失败回滚
    // 会把并发正常 B 的 INCR 一并 DECR 清零
    // Q4：持续降级超阈值升级为聚合告警
    noteRedisDegraded(`quota:${action}`)
    return { consumed: false, key }
  }
  const used = Number(raw)
  // Q4：配额存储恢复正常，重置降级计时
  noteRedisRecovered()

  if (used > limit) {
    const label =
      action === 'backup'
        ? '备份'
        : action === 'upload'
          ? '上传'
          : action === 'notify'
            ? '通知'
            : '创建用户'
    throw new ConflictException(`今日${label}次数已达上限（${limit} 次），请明日再试`)
  }
  return { consumed: true, key }
}

/**
 * L1：回滚一次已扣配额（备份锁忙未实际执行时退还）——GET>0 守卫后再 DECR，
 * 与并发消耗交错也不会打负。
 * L2：key 必须取 consumeDailyQuota 返回值，避免跨零点退到错日键
 */
export async function rollbackDailyQuota(redis: RedisService, key: string): Promise<void> {
  await redis.eval(
    `local n = tonumber(redis.call('GET', KEYS[1]))
     if n and n > 0 then return redis.call('DECR', KEYS[1]) end
     return 0`,
    [key],
    [],
  )
}

function quotaKey(action: QuotaAction, userId: number, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  return `quota:${action}:${userId}:${date}`
}
