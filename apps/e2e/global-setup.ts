import { adminUser, normalUser, targetUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { cleanupAll, fetchAllPages } from '@e2e/helpers/cleanup'

/**
 * Playwright 全局 setup：在所有测试前准备测试数据
 *
 * 流程：
 *   1. 轮询等待 server 健康
 *   2. 用 admin 登录（apiClient 持久化 token）
 *   3. 清理历史 e2e 残留数据
 *   4. 创建 e2e 普通用户 + e2e 目标用户（用 admin 调 POST /users，绕过注册流程）
 *
 * 注意：不依赖 mail 服务，避免 e2e 环境配置复杂化
 */

async function waitForServer(maxRetries = 30, intervalMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch('http://localhost:9000/api/v1/health', {
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) return
    } catch {
      // server 尚未就绪
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`server 在 ${maxRetries * intervalMs}ms 内未就绪`)
}

async function findUserId(username: string): Promise<number | null> {
  const users = await fetchAllPages<{ id: number; username: string }>('/users')
  const user = users.find((u) => u.username === username)
  return user?.id ?? null
}

async function findRoleId(name: string): Promise<number | undefined> {
  const roles = await fetchAllPages<{ id: number; name: string }>('/roles')
  return roles.find((r) => r.name === name)?.id
}

async function ensureUser(
  user: { username: string; password: string; email: string; nickname: string },
  roleId: number | undefined,
) {
  // 已存在则强制重置 role_id（防止上次测试污染，例如 e2e_target_user 被改成 admin 角色）
  const existingId = await findUserId(user.username)
  if (existingId) {
    console.log(
      `[global-setup] 用户 ${user.username} 已存在 (id=${existingId})，重置 role_id=${roleId}`,
    )
    if (roleId !== undefined) {
      // 顺带重置 email，保持测试数据一致（UpdateUserSchema 中 email/roleId 均为可选）
      const { status } = await apiClient.patch(`/users/${existingId}`, {
        email: user.email,
        roleId,
      })
      if (status !== 200) {
        throw new Error(`重置用户 ${user.username} role_id 失败: status=${status}`)
      }
    }
    return
  }

  // 不存在则创建（mustChangePassword: false 为知情豁免——夹具密码即最终密码，避免夹具被首登改密锁死）
  const { status, data } = await apiClient.post<{ id: number }>(
    '/users',
    {
      username: user.username,
      email: user.email,
      password: user.password,
      nickname: user.nickname,
      roleId: roleId ?? undefined,
      status: true,
      mustChangePassword: false,
    },
    201,
  )

  if (status === 201 && data?.id) {
    console.log(`[global-setup] 创建用户 ${user.username} (id=${data.id})`)
  } else {
    throw new Error(`创建用户 ${user.username} 失败: status=${status}`)
  }
}

export default async function globalSetup() {
  console.log('[global-setup] 等待 server 就绪...')
  await waitForServer()

  console.log('[global-setup] admin 登录...')
  await apiClient.login(adminUser.username, adminUser.password)

  console.log('[global-setup] 清理历史 e2e 残留数据...')
  await cleanupAll()

  console.log('[global-setup] 查询普通用户角色 id...')
  const userRoleId = await findRoleId('user')

  console.log('[global-setup] 创建 e2e 普通用户 + 目标用户...')
  await ensureUser(normalUser, userRoleId)
  await ensureUser(targetUser, userRoleId)

  console.log('[global-setup] 完成')
}
