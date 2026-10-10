import { ConflictException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { consumeDailyQuota } from './daily-quota'

describe('consumeDailyQuota（L6 日配额）', () => {
  it('配额内放行；键含动作/用户/当日日期，TTL 续期到次日零点', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(3),
      expire: vi.fn().mockResolvedValue(true),
    }

    await expect(consumeDailyQuota(redis as never, 'backup', 7, 5)).resolves.toBeUndefined()

    const key = expect.stringMatching(/^quota:backup:7:\d{8}$/)
    expect(redis.incr).toHaveBeenCalledWith(key)
    expect(redis.expire).toHaveBeenCalledWith(key, expect.any(Number))
    const ttl = redis.expire.mock.calls[0][1] as number
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(86400)
  })

  it('超出配额抛 409，提示动作与上限', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(6),
      expire: vi.fn().mockResolvedValue(true),
    }

    await expect(consumeDailyQuota(redis as never, 'upload', 7, 5)).rejects.toThrow(
      '今日上传次数已达上限（5 次）',
    )
    await expect(consumeDailyQuota(redis as never, 'backup', 7, 3)).rejects.toThrow(
      ConflictException,
    )
  })
})
