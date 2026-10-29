import { ConflictException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

const mockAppendErrorLog = vi.fn()
vi.mock('@/common/logger', () => ({
  appendErrorLog: (...args: unknown[]) => mockAppendErrorLog(...args),
}))

import { consumeDailyQuota, rollbackDailyQuota, rollbackDailyQuotaQuietly } from './daily-quota'

function mockRedis(evalResult: number) {
  return { eval: vi.fn().mockResolvedValue(evalResult) }
}

describe('consumeDailyQuota（L6 日配额）', () => {
  it('配额内放行；键含动作/用户/当日日期，Lua 原子 INCR+首置 EXPIRE 到次日零点', async () => {
    const redis = mockRedis(3)

    const result = await consumeDailyQuota(redis as never, 'backup', 7, 5)
    expect(result.consumed).toBe(true)
    expect(result.key).toMatch(/^quota:backup:7:\d{8}$/)

    const [script, keys, args] = redis.eval.mock.calls[0] as [string, string[], number[]]
    expect(script).toContain('INCR')
    expect(script).toContain('EXPIRE')
    expect(keys[0]).toBe(result.key)
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

  it('L4：Redis 故障降级放行（未扣额、不抛错，与全仓 fail-open 口径一致）', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('redis down')) }

    // Q3：fail-open 返回 consumed=false 标记未实扣
    const result = await consumeDailyQuota(redis as never, 'upload', 7, 3)
    expect(result.consumed).toBe(false)
    expect(mockAppendErrorLog).toHaveBeenCalledWith(expect.stringContaining('未扣额放行'))
  })
})

describe('rollbackDailyQuota（L1 配额退还）', () => {
  it('GET>0 守卫后 DECR，扣/退使用同一日键', async () => {
    const redis = mockRedis(1)

    const { key } = await consumeDailyQuota(redis as never, 'backup', 7, 5)
    await expect(rollbackDailyQuota(redis as never, key)).resolves.toBeUndefined()

    // call[0] 是 consume 的 INCR，call[1] 是 rollback 的 DECR
    const [script, keys, args] = redis.eval.mock.calls[1] as [string, string[], unknown[]]
    expect(script).toContain('GET')
    expect(script).toContain('DECR')
    expect(script).toContain('> 0')
    expect(keys[0]).toBe(key)
    expect(keys[0]).toMatch(/^quota:backup:7:\d{8}$/)
    expect(args).toEqual([])
  })
})

describe('rollbackDailyQuotaQuietly（L3 退额失败口径）', () => {
  it('退额抛错时登记 error_logs 并吞掉，不顶替原始业务错误', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('redis down')) }

    await expect(
      rollbackDailyQuotaQuietly(redis as never, 'quota:upload:7:20260101'),
    ).resolves.toBeUndefined()
    expect(mockAppendErrorLog).toHaveBeenCalledWith(expect.stringContaining('配额退还失败'))
  })
})
