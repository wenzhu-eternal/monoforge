import { redirect } from '@tanstack/react-router'
import { PermissionCodes } from '@/lib/permissions'
import { useAuthStore } from '@/store/auth-store'

// 路径到权限码的映射（AuthenticatedLayout 在 useCurrentUser 加载完成后据此校验）
const ROUTE_PERMISSION_MAP: Array<{ pattern: string; permission: string }> = [
  { pattern: '/users', permission: PermissionCodes.USER_VIEW },
  { pattern: '/files', permission: PermissionCodes.FILE_VIEW },
  { pattern: '/roles', permission: PermissionCodes.ROLE_VIEW },
  { pattern: '/permissions', permission: PermissionCodes.PERMISSION_VIEW },
  { pattern: '/audit-logs', permission: PermissionCodes.AUDIT_VIEW },
  { pattern: '/error-logs', permission: PermissionCodes.ERROR_LOG_VIEW },
  { pattern: '/mail', permission: PermissionCodes.MAIL_SEND },
]

/**
 * 查找当前路径所需的权限码，无匹配返回 undefined（如 dashboard/websocket 无需权限）
 */
export function getRequiredPermission(pathname: string): string | undefined {
  for (const route of ROUTE_PERMISSION_MAP) {
    if (pathname === route.pattern || pathname.startsWith(`${route.pattern}/`)) {
      return route.permission
    }
  }
  return undefined
}

/**
 * 路由级认证守卫：校验登录标记 + token 存在性，不检查权限
 * token 不持久化（partialize 排除），刷新后由 main.tsx 的 bootstrapAuth 用 httpOnly cookie 恢复；
 * 若 bootstrapAuth 失败则 logout() 置 isAuthenticated=false，此处 token 校验为兜底防御
 * 权限校验由 AuthenticatedLayout 在 useCurrentUser 加载完成后统一处理（避免使用 localStorage 中可能过期的 permissions 旧值导致首屏误 redirect 到 /403）
 */
export function requireAuth() {
  return () => {
    const { isAuthenticated, token } = useAuthStore.getState()
    if (!isAuthenticated || !token) {
      throw redirect({ to: '/login' })
    }
  }
}
