import type { QueryClient } from '@tanstack/react-query'

// R09：审计由后端拦截器异步落库，写操作成功后立即失效审计查询，其回查可能早于审计真正入库，
// 旧结果于是重新成为 30s 新鲜缓存，审计页在一段时间内看不到刚产生的记录。
// 采用"立即失效 + 有界延迟主动重取"：覆盖审计晚于首次回查落库的窗口，且不假设单一固定延迟
//（异步审计耗时随 Redis 配额检查 / DB 抖动变化）。
// R08：最后一次回查后再标脏（refetchType:'none' 不立即回查），避免旧结果被缓存为 30s 新鲜数据后
// 停留页面不更新——用户离开再进入/重挂载时按 staleTime 重新取数。
const AUDIT_RETRY_DELAYS_MS = [300, 900, 2700]

export function invalidateAuditLogs(queryClient: QueryClient): void {
  const queryKey = ['audit-logs']
  queryClient.invalidateQueries({ queryKey })
  const last = AUDIT_RETRY_DELAYS_MS[AUDIT_RETRY_DELAYS_MS.length - 1]
  for (const delay of AUDIT_RETRY_DELAYS_MS) {
    setTimeout(() => {
      if (delay === last) {
        queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
      } else {
        void queryClient.refetchQueries({ queryKey, type: 'active' })
      }
    }, delay)
  }
}
