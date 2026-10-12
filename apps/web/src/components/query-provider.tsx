import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { bindCrossTabAuthSync, setQueryClientForAuth } from '@/lib/auth-cleanup'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // L30：401/403 属确定性失败（无权限/未登录），重试只会白打一次请求
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status
        if (status === 401 || status === 403) return false
        return failureCount < 1
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

// 注册给登出清理逻辑使用（axios 拦截器等非组件环境无法用 useQueryClient）
setQueryClientForAuth(queryClient)
// M7：跨 tab 登出/换号广播（storage 事件，模块级注册一次）
bindCrossTabAuthSync()

export const QueryProvider = ({ children }: { children: ReactNode }) => {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
