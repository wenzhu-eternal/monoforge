import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { requireAuth } from '@/lib/route-guards'

/**
 * J4：登录态 pathless layout——10 个登录态页面收拢于此，认证守卫与布局只写一次。
 * 业务数据请求仍须放在各页内层 Content 组件（Layout 的 mustChangePassword / 权限重定向
 * 先于业务请求执行，否则强制改密用户会先打出白名单外请求 401 被踢走）。
 * login/403/setup/index/not-found 留在外层（无需登录）。
 */
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: requireAuth(),
  component: () => (
    <AuthenticatedLayout>
      <Outlet />
    </AuthenticatedLayout>
  ),
})
