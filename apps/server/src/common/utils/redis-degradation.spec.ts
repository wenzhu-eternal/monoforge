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

    // 持续故障期间调用不断（间隔小于阈值，不触发 L8 新话单重置）
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(60_000)
      noteRedisDegraded('auth:jti')
    }
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
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(60_000)
      noteRedisDegraded('throttler')
    }
    expect(mockAppendErrorLog).toHaveBeenCalledTimes(1)

    noteRedisRecovered()
    expect(getRedisDegradationState().degradedSince).toBeNull()

    vi.advanceTimersByTime(60_000)
    noteRedisDegraded('throttler')
    expect(mockAppendErrorLog).toHaveBeenCalledTimes(1)
  })

  it('L8：静默超过阈值后的再降级视为新话单，不按旧起点夸大持续时长', () => {
    noteRedisDegraded('quota:upload')
    // 静默站点整日零调用：期间没有任何降级触发
    vi.advanceTimersByTime(24 * 60 * 60_000)
    noteRedisDegraded('throttler')
    // 新话单起点为本次触发时刻，未满阈值不升级
    expect(mockAppendErrorLog).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    noteRedisDegraded('throttler')
    expect(mockAppendErrorLog).not.toHaveBeenCalled()
  })

  it('L8：持续故障（触发间隔小于阈值）仍按原起点升级告警', () => {
    noteRedisDegraded('a')
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(60_000)
      noteRedisDegraded('a')
    }
    vi.advanceTimersByTime(60_000)
    noteRedisDegraded('a')

    expect(mockAppendErrorLog).toHaveBeenCalledTimes(1)
    expect(mockAppendErrorLog.mock.calls[0][0]).toContain('降级放行已持续')
  })
})
