import { Injectable } from '@nestjs/common'
import type { ThrottlerStorage } from '@nestjs/throttler'
import { appendErrorLog } from '@/common/logger'
import { noteRedisDegraded, noteRedisRecovered } from '@/common/utils/redis-degradation'
import { RedisService } from '@/modules/redis/redis.service'

// L16：fail-open 告警按分钟限频——Redis 故障 + 公开端点被刷时，日志量不随 QPS 线性放大
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000
let lastFailOpenLogAt = 0

/**
 * 基于 Redis 的限流存储：多实例部署下共享限流计数
 * 使用 Lua 脚本保证 INCR + EXPIRE 原子性，避免并发下永久限流
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  // Lua 脚本：INCR + 首次设 TTL + 仅首次超限时设 blockDuration
  // KEYS[1] = redisKey, ARGV[1] = ttlSeconds, ARGV[2] = limit, ARGV[3] = blockSeconds
  private static readonly SCRIPT = `
    local hits = redis.call('INCR', KEYS[1])
    if hits == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    local blocked = 0
    if hits > tonumber(ARGV[2]) then
      blocked = 1
      -- 仅首次进入 blocked 状态（hits == limit+1）时设置 blockDuration，避免每次请求重置 TTL 导致永久 block
      if hits == tonumber(ARGV[2]) + 1 and tonumber(ARGV[3]) > 0 then
        redis.call('EXPIRE', KEYS[1], ARGV[3])
      end
    end
    return {hits, blocked}
  `

  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number
    timeToExpire: number
    isBlocked: boolean
    timeToBlockExpire: number
  }> {
    const redisKey = `throttle:${throttlerName}:${key}`
    const ttlSeconds = Math.ceil(ttl / 1000)
    const blockSeconds = Math.ceil(blockDuration / 1000)

    // M8：Redis 抖动 fail-open——原 eval 抛错直穿 ThrottlerGuard（@nestjs/throttler 无兜底），
    // 故障期每个请求（含 /health）都 500；与登录锁定/审计封顶的"故障放行"降级口径对齐。
    // 放行而非阻断：限流是防滥用的可用性优化，Redis 短暂不可用不应放大成全站 500。
    try {
      const result = (await this.redisService.eval(
        RedisThrottlerStorage.SCRIPT,
        [redisKey],
        [ttlSeconds, limit, blockSeconds],
      )) as [number, number]

      const totalHits = result[0]
      const isBlocked = result[1] === 1
      // Q4：限流存储恢复正常，重置降级计时
      noteRedisRecovered()

      // 用 TTL 命令取真实剩余时间（毫秒），让 429 的 Retry-After 头反映实际等待秒数；
      // 异常值（-1 永久/-2 不存在）回退到入参 ttl。blocked 时脚本已把 key TTL 改为 blockDuration，剩余即 block 剩余
      const realTtl = await this.redisService.ttl(redisKey)
      const timeToExpire = realTtl > 0 ? realTtl * 1000 : ttl

      return {
        totalHits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire: isBlocked && blockSeconds > 0 ? Math.max(realTtl, 0) * 1000 : 0,
      }
    } catch (err) {
      // fail-open 放行：限流是防滥用的可用性优化，Redis 短暂不可用不应放大成全站 500。
      // 写文件日志告警——放行动作本身需要可观测，否则限流静默失效无从发现；
      // L16：每分钟至多一条，防公开端点被刷时日志量线性放大
      const now = Date.now()
      if (now - lastFailOpenLogAt >= FAIL_OPEN_LOG_INTERVAL_MS) {
        lastFailOpenLogAt = now
        appendErrorLog(
          `[Throttler] Redis 限流存储异常，本次请求 fail-open 放行: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      // Q4：持续降级超阈值升级为聚合告警
      noteRedisDegraded('throttler')
      return {
        totalHits: 1,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      }
    }
  }
}
