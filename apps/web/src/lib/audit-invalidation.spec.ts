import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateAuditLogs } from './audit-invalidation'

describe('invalidateAuditLogs（R08 审计晚于首次回查落库）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('落库晚于首次回查 → 有界主动重取后列表可见新数据（真实取数，非 mock 调用次数）', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let data: unknown[] = []
    const observer = new QueryObserver(qc, {
      queryKey: ['audit-logs'],
      queryFn: async () => data,
    })
    const unsubscribe = observer.subscribe(() => {})

    // 初次取数
    await vi.advanceTimersByTimeAsync(0)
    expect(observer.getCurrentResult().data).toEqual([])

    invalidateAuditLogs(qc)
    // 审计在首次回查之后才落库
    data = [{ id: 1, action: 'create', resource: 'user' }]

    // 推进全部延迟（300/900/2700），主动重取应把新数据取回
    await vi.runAllTimersAsync()

    expect(observer.getCurrentResult().data).toEqual([
      { id: 1, action: 'create', resource: 'user' },
    ])
    unsubscribe()
  })

  it('超过上界后标脏（refetchType:none 不立即回查），重进可按 staleTime 重新取数', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observer = new QueryObserver(qc, {
      queryKey: ['audit-logs'],
      queryFn: async () => [],
    })
    const unsubscribe = observer.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)

    invalidateAuditLogs(qc)
    await vi.runAllTimersAsync()

    // 窗口结束后查询被标脏：离开再进入会重新取数，不会把旧结果当 30s 新鲜数据长期停留
    expect(observer.getCurrentResult().isStale).toBe(true)
    unsubscribe()
  })
})
