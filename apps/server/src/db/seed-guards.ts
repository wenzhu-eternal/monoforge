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
