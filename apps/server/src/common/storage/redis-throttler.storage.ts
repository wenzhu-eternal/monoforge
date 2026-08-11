import { Injectable } from '@nestjs/common'
import type { ThrottlerStorage } from '@nestjs/throttler'
import { RedisService } from '@/modules/redis/redis.service'

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

    const result = (await this.redisService.eval(
      RedisThrottlerStorage.SCRIPT,
      [redisKey],
      [ttlSeconds, limit, blockSeconds],
    )) as [number, number]

    const totalHits = result[0]
    const isBlocked = result[1] === 1

    return {
      totalHits,
      timeToExpire: ttl,
      isBlocked,
      timeToBlockExpire: isBlocked ? blockDuration : 0,
    }
  }
}
