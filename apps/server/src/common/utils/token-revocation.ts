import type { RedisService } from '@/modules/redis/redis.service'

// access token 有效期 15min，黑名单 TTL 与其对齐
const ACCESS_BLACKLIST_TTL_SECONDS = 15 * 60

/**
 * L6：批量吊销用户活跃 access token（读活跃 jti → 写黑名单 → 清活跃记录）。
 * auth/users 原先各自内联一份逐行等价实现，任一处演进（改 TTL/SCAN 语义）极易漏改另一处。
 */
export async function revokeActiveAccessTokens(
  redisService: RedisService,
  userId: number,
): Promise<void> {
  const prefix = `access:active:${userId}:`
  const activeKeys = await redisService.scanKeys(`${prefix}*`)
  if (activeKeys.length === 0) return
  for (const key of activeKeys) {
    const jti = key.slice(prefix.length)
    await redisService.set(`access:${userId}:${jti}`, '1', ACCESS_BLACKLIST_TTL_SECONDS)
  }
  await redisService.deleteByPattern(`${prefix}*`)
}
