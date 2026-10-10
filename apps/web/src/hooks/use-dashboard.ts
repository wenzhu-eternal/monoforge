import type { ApiResponse, DashboardStats } from '@shared'
import { useQuery } from '@tanstack/react-query'
import { type ApiRequestConfig, api } from '@/lib/api'

export const useDashboardStats = () => {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      // 调用后端聚合接口，正确统计超过 100 人场景（避免前端全表扫描）。
      // 无权限时 403 不整页跳转，由仪表盘右侧内容区展示无权限（skipForbiddenRedirect）。
      const response = await api.get<ApiResponse<DashboardStats>>('/api/v1/users/stats', {
        skipForbiddenRedirect: true,
      } as ApiRequestConfig)
      return response.data.data!
    },
    staleTime: 60 * 1000, // 1 分钟内不重复请求
  })
}

export const useHealthStatus = () => {
  return useQuery({
    queryKey: ['health', 'status'],
    queryFn: async () => {
      // L26：仪表盘"系统状态"改真实探测——health 为 @Public，非 admin 也只回 {status, timestamp}
      const response = await api.get<ApiResponse<{ status: string }>>('/api/v1/health')
      return response.data.data!.status
    },
    staleTime: 30 * 1000,
    retry: 1, // 后端故障时快速落到"异常"展示，不做多次重试拖慢
  })
}
