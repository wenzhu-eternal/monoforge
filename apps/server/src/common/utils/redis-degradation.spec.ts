import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAppendErrorLog = vi.fn()
vi.mock('@/common/logger', () => ({
  appendErrorLog: (...args: unknown[]) => mockAppendErrorLog(...args),
}))

import {
  getRedisDegradationState,
  noteRedisDegraded,
  noteRedisRecovered,
} from './redis-degradation'

describe('redis-degradation（Q4 降级持续时长告警升级）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T00:00:00Z'))
    noteRedisRecovered()
    mockAppendErrorLog.mockClear()
  })

  it('首次降级只记起点，短时抖动不升级告警', () => {
    noteRedisDegraded('quota:upload')
    expect(getRedisDegradationState().degradedSince).not.toBeNull()

    vi.advanceTimersByTime(60_000)
    noteRedisDegraded('throttler')
    expect(mockAppendErrorLog).not.toHaveBeenCalled()
  })

  it('持续超过 5 分钟升级为聚合告警，且同一窗口内不重复刷屏', () => {
    noteRedisDegraded('auth:jti')

    vi.advanceTimersByTime(5 * 60_000 + 1)
    noteRedisDegraded('auth:jti')
    expect(mockAppendErrorLog).toHaveBeenCalledTimes(1)
    expect(mockAppendErrorLog.mock.calls[0][0]).toContain('降级放行已持续')
    expect(mockAppendErrorLog.mock.calls[0][0]).toContain('auth:jti')

    // 同一 5 分钟窗口内再次触发 → 不再写
    vi.advanceTimersByTime(60_000)
    noteRedisDegraded('quota:backup')
    expect(mockAppendErrorLog).toHaveBeenCalledTimes(1)
  })

  it('恢复后重置计时：短暂恢复再降级不立刻告警', () => {
    noteRedisDegraded('throttler')
    vi.advanceTimersByTime(5 * 60_000 + 1)
    noteRedisDegraded('throttler')
    expect(mockAppendErrorLog).toHaveBeenCalledTimes(1)

    noteRedisRecovered()
    expect(getRedisDegradationState().degradedSince).toBeNull()

    vi.advanceTimersByTime(60_000)
    noteRedisDegraded('throttler')
    expect(mockAppendErrorLog).toHaveBeenCalledTimes(1)
  })
})
