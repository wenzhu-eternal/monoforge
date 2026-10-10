import { ConflictException } from '@nestjs/common'
import type { RedisService } from '@/modules/redis/redis.service'

/**
 * L6：按用户+动作的日配额（Redis INCR 计数，TTL 续期到当日 24:00）——
 * 收口 schedule:backup / file:upload 持有者无频控滥用（已授权功能的纵深项）。
 * 每次 incr 都续期，防首次 expire 丢失后计数键永不过期；超限抛 409
 */
export async function consumeDailyQuota(
  redis: RedisService,
  action: 'backup' | 'upload',
  userId: number,
  limit: number,
): Promise<void> {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  const ttl = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 1000))

  const key = `quota:${action}:${userId}:${date}`
  const used = await redis.incr(key)
  await redis.expire(key, ttl)

  if (used > limit) {
    const label = action === 'backup' ? '备份' : '上传'
    throw new ConflictException(`今日${label}次数已达上限（${limit} 次），请明日再试`)
  }
}
