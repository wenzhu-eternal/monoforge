import type { ApiResponse, DashboardStats } from '@shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const useDashboardStats = () => {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      // 调用后端聚合接口，正确统计超过 100 人场景（避免前端全表扫描）
      const response = await api.get<ApiResponse<DashboardStats>>('/api/v1/users/stats')
      return response.data.data!
    },
    staleTime: 60 * 1000, // 1 分钟内不重复请求
  })
}
