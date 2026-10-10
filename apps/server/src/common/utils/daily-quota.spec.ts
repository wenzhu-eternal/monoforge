import { ConflictException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { consumeDailyQuota } from './daily-quota'

function mockRedis(evalResult: number) {
  return { eval: vi.fn().mockResolvedValue(evalResult) }
}

describe('consumeDailyQuota（L6 日配额）', () => {
  it('配额内放行；键含动作/用户/当日日期，Lua 原子 INCR+首置 EXPIRE 到次日零点', async () => {
    const redis = mockRedis(3)

    await expect(consumeDailyQuota(redis as never, 'backup', 7, 5)).resolves.toBeUndefined()

    const [script, keys, args] = redis.eval.mock.calls[0] as [string, string[], number[]]
    expect(script).toContain('INCR')
    expect(script).toContain('EXPIRE')
    expect(keys[0]).toMatch(/^quota:backup:7:\d{8}$/)
    expect(args[0]).toBeGreaterThan(0)
    expect(args[0]).toBeLessThanOrEqual(86400)
  })

  it('超出配额抛 409，提示动作与上限', async () => {
    await expect(consumeDailyQuota(mockRedis(6) as never, 'upload', 7, 5)).rejects.toThrow(
      '今日上传次数已达上限（5 次）',
    )
    await expect(consumeDailyQuota(mockRedis(4) as never, 'backup', 7, 3)).rejects.toThrow(
      ConflictException,
    )
  })
})
