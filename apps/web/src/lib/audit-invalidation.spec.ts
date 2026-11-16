import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateAuditLogs } from './audit-invalidation'

describe('invalidateAuditLogs（R09 审计晚于首次回查落库）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('立即失效 + 三次有界延迟再失效（覆盖异步审计落库晚于首次回查）', () => {
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation(() => Promise.resolve())

    invalidateAuditLogs(qc)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['audit-logs'] })

    invalidate.mockClear()
    vi.advanceTimersByTime(2700)
    expect(invalidate).toHaveBeenCalledTimes(3)

    invalidate.mockClear()
    vi.advanceTimersByTime(10_000)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
