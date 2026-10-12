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
  // M11：清掉跨 tab 共享的刷新产物，防止登出/刷新失败后下个登录复用到上个用户的 token
  try {
    localStorage.removeItem('monoforge-auth-refresh-at')
    localStorage.removeItem('monoforge-auth-refresh-token')
  } catch {
    // 存储不可用时无需清理
  }
  useAuthStore.getState().logout()
  queryClientRef?.clear()
}

const AUTH_STORAGE_KEY = 'auth-storage'
let crossTabBound = false

/**
 * M7：跨 tab 登出/换号广播——storage 事件仅在其他 tab 写入时触发（本 tab 不会自我清除）。
 * 另一 tab 登出/清态或换号登录时本 tab 同步 clearUserScopedState，配合 Layout 的
 * !isAuthenticated 跳 /login；refetchOnWindowFocus 已关闭，不主动清则空闲页
 * 会无限期渲染上一用户数据直到下次操作 401。同账号写入（token 轮换）不干预。
 */
export function bindCrossTabAuthSync() {
  if (crossTabBound || typeof window === 'undefined') return
  crossTabBound = true
  window.addEventListener('storage', (e) => {
    // e.key 为 null 表示整仓 clear()，同样按登出信号处理（raw 置 null → 必清）
    if (e.key !== null && e.key !== AUTH_STORAGE_KEY) return
    const current = useAuthStore.getState()
    if (!current.isAuthenticated) return
    const raw = e.key === AUTH_STORAGE_KEY ? e.newValue : null
    let sameUser = false
    try {
      const parsed = raw
        ? (JSON.parse(raw) as {
            state?: { user?: { id?: number } | null; isAuthenticated?: boolean }
          })
        : null
      const next = parsed?.state
      sameUser =
        next?.isAuthenticated === true && next.user?.id != null && next.user.id === current.user?.id
    } catch {
      // 解析失败按登出处理（fail-closed，宁可清态不可残留他人数据）
    }
    if (sameUser) return
    clearUserScopedState()
  })
}
