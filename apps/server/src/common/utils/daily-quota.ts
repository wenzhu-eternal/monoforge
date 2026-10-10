import { ConflictException } from '@nestjs/common'
import type { RedisService } from '@/modules/redis/redis.service'

/**
 * L6：按用户+动作的日配额（Redis 计数，TTL 到当日 24:00）——
 * 收口 schedule:backup / file:upload 持有者无频控滥用（已授权功能的纵深项）。
 * INCR+EXPIRE 走 Lua 原子（SECURITY.md 限流规范：两步调用在进程中断时会留无 TTL
 * 永驻 key）；超限抛 409
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
  const used = Number(
    await redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return n`,
      [key],
      [ttl],
    ),
  )

  if (used > limit) {
    const label = action === 'backup' ? '备份' : '上传'
    throw new ConflictException(`今日${label}次数已达上限（${limit} 次），请明日再试`)
  }
}
