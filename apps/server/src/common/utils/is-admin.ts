/**
 * 判断用户是否为超级管理员（基于角色 ID）
 *
 * - 优先使用环境变量 ADMIN_ROLE_ID（env schema 已校验，默认 1）
 * - 纯函数，不依赖 NestJS DI，可在 controller / service / guard 中通用
 */
export function isAdminUser(user: { roleId?: number | null } | null | undefined): boolean {
  if (!user || user.roleId == null) return false
  const adminRoleId = Number(process.env.ADMIN_ROLE_ID) || 1
  return user.roleId === adminRoleId
}
