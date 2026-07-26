import { redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/store/auth-store'

/**
 * 路由级认证守卫：仅检查登录状态，不检查权限
 */
export function requireAuth() {
  return () => {
    const { isAuthenticated } = useAuthStore.getState()
    if (!isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  }
}

/**
 * 路由级权限守卫：仅检查登录状态
 * 权限校验由 AuthenticatedLayout 在 useCurrentUser 加载完成后统一处理
 * （避免 beforeLoad 中使用 localStorage 旧值导致首屏误 redirect）
 */
export function requirePermission(_permission?: string) {
  return () => {
    const { isAuthenticated } = useAuthStore.getState()

    if (!isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  }
}
