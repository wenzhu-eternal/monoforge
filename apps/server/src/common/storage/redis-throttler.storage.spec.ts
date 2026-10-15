import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendErrorLog } from '@/common/logger'
import { RedisService } from '@/modules/redis/redis.service'
import { RedisThrottlerStorage } from './redis-throttler.storage'

vi.mock('@/common/logger', () => ({
  appendErrorLog: vi.fn(),
}))

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage
  let redisService: { eval: ReturnType<typeof vi.fn>; ttl: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    redisService = {
      eval: vi.fn(),
      ttl: vi.fn(),
    }
    storage = new RedisThrottlerStorage(redisService as unknown as RedisService)
  })

  it('正常路径：返回 hits 与阻断态，TTL 命令取真实剩余时间', async () => {
    redisService.eval.mockResolvedValue([3, 0])
    redisService.ttl.mockResolvedValue(42)

    const result = await storage.increment('k', 60_000, 10, 0, 'default')

    expect(result).toEqual({
      totalHits: 3,
      timeToExpire: 42_000,
      isBlocked: false,
      timeToBlockExpire: 0,
    })
  })

  it('M8：Redis eval 抛错 → fail-open 放行（不阻断）并写文件告警，故障期不再放大成全站 500', async () => {
    redisService.eval.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await storage.increment('k', 60_000, 10, 0, 'default')

    expect(result).toEqual({
      totalHits: 1,
      timeToExpire: 60_000,
      isBlocked: false,
      timeToBlockExpire: 0,
    })
    expect(appendErrorLog).toHaveBeenCalledWith(expect.stringContaining('fail-open 放行'))
  })

  it('M8：blocked 时 timeToBlockExpire 取真实剩余（blockDuration>0）', async () => {
    redisService.eval.mockResolvedValue([11, 1])
    redisService.ttl.mockResolvedValue(30)

    const result = await storage.increment('k', 60_000, 10, 60_000, 'default')

    expect(result.isBlocked).toBe(true)
    expect(result.timeToBlockExpire).toBe(30_000)
  })
})
