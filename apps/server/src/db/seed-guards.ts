import { UserEmailSchema } from '@shared/schemas/user'

/**
 * seed 的“用户名占位”守卫。
 *
 * 部分唯一索引只约束活跃行：公开注册环境可能先创建 username='admin' 的普通用户。
 * 此时 admin 角色用户数仍为 0，seed 会进入补建分支；若直接 upsert 会把该用户密码
 * 重置为 SEED_ADMIN_PASSWORD（默认 888888），等同于账号接管。这里必须 fail-fast。
 */
export function assertAdminUsernameAvailable(
  existing: { id: number; roleId: number | null } | undefined,
  adminRoleId: number,
): void {
  if (!existing || existing.roleId === adminRoleId) return

  throw new Error(
    `用户名 admin 已被非管理员账号占用（用户 ID ${existing.id}，roleId ${existing.roleId ?? 'null'}），` +
      `拒绝 seed 以免重置其密码。请先将该账号改名或软删，再重新执行 seed（期望 admin roleId=${adminRoleId}）`,
  )
}

/**
 * P2-12：SEED_ADMIN_EMAIL 与注册/建户共用同一邮箱契约（trim + 小写化 + 格式/域名校验）。
 * 原样入库会绕过唯一性归一与保留域限制，非法值则在首次建号时才撞 DB 约束——此处 fail-fast。
 */
export function resolveSeedAdminEmail(raw?: string): string {
  const result = UserEmailSchema.safeParse(raw ?? 'admin@example.com')
  if (!result.success) {
    throw new Error(
      `SEED_ADMIN_EMAIL 非法：${result.error.issues.map((issue) => issue.message).join('；')}。` +
        '请修正环境变量后重新执行 seed',
    )
  }
  return result.data
}

/**
 * P2-13：seed 成功输出只保留定位账号所需字段，避免把密码哈希、邮箱打进构建/部署日志。
 */
export function toSafeAdminLog(user: { id: number; username: string; roleId: number | null }): {
  id: number
  username: string
  roleId: number | null
} {
  return { id: user.id, username: user.username, roleId: user.roleId }
}
