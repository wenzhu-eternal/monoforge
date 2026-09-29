import type { QueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth-store'

/**
 * QueryProvider 挂载时注册全局 queryClient 实例。
 * 登出逻辑分散在 axios 拦截器等 React 组件树之外，无法用 useQueryClient，故用模块级引用桥接。
 */
let queryClientRef: QueryClient | null = null

export function setQueryClientForAuth(client: QueryClient | null) {
  queryClientRef = client
}

/**
 * 清空所有与当前用户绑定的客户端状态：zustand 认证态 + React Query 全量缓存。
 *
 * 必须清缓存：QueryClient 默认 gcTime 为 5 分钟，仅清 zustand 会让下一个登录用户
 * 在缓存过期前先渲染上一个用户的 users/files/error-logs 等数据，造成跨账号数据泄漏。
 */
export function clearUserScopedState() {
  useAuthStore.getState().logout()
  queryClientRef?.clear()
}
