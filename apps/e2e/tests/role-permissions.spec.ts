import { adminUser, E2E_API_BASE, normalUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { cleanupTempRoles, cleanupTempUsers } from '@e2e/helpers/cleanup'
import { expect, test } from '@playwright/test'

/**
 * 角色-权限绑定完整链路 e2e（纯 API）
 *
 * 覆盖用户关心的真实业务场景：
 *   - 角色-权限绑定（PUT /role-permissions/role/:roleId）
 *   - 权限验证链路（配置权限后用户登录权限变化）
 *   - 角色守卫（普通用户越权访问 role-permissions → 403）
 *   - 删除角色时的用户引用冲突（409）
 *   - 查询所有角色权限关联（GET /role-permissions）
 *
 * 数据隔离：用 e2e- 前缀的临时角色/用户，global-teardown 自动清理
 */

interface LoginResponse {
  accessToken: string
  user: {
    id: number
    username: string
    permissions?: string[]
    roleId?: number
  }
}

async function rawLogin(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${E2E_API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error(`登录失败 ${res.status}`)
  const json = (await res.json()) as { code: number; data: LoginResponse }
  return json.data
}

test.beforeAll(async () => {
  await apiClient.login(adminUser.username, adminUser.password)
  // 清理历史残留
  await cleanupTempUsers()
  await cleanupTempRoles()
})

test.describe('角色-权限绑定链路', () => {
  let tempRoleId: number
  const tempRoleName = `e2e-rp-role-${Date.now()}`
  const tempUsername = `e2e_rp_user_${Date.now()}`

  test.beforeAll(async () => {
    // 1. 创建临时角色
    const { data: role } = await apiClient.post<{ id: number }>(
      '/roles',
      { name: tempRoleName, description: '角色权限绑定测试' },
      201,
    )
    expect(role?.id).toBeTruthy()
    tempRoleId = role.id

    // 2. 创建临时用户绑定该角色（用于后续登录验证权限变化）
    const { data: user } = await apiClient.post<{ id: number }>(
      '/users',
      {
        username: tempUsername,
        email: `${tempUsername}@test.com`,
        password: 'e2e-password-123',
        nickname: 'RP 测试用户',
        roleId: tempRoleId,
      },
      201,
    )
    expect(user?.id).toBeTruthy()
  })

  test('GET /role-permissions → 200 + 数组', async () => {
    const { status, data } = await apiClient.get<unknown[]>('/role-permissions')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  test('GET /role-permissions/role/:roleId → 200', async () => {
    const { status, data } = await apiClient.get<string[]>(`/role-permissions/role/${tempRoleId}`)
    expect(status).toBe(200)
    // 新角色默认无权限
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  test('给角色配置权限 → 用户登录后拥有该权限', async () => {
    // 先查可用权限码（取 seed 创建的 user:view）
    const { data: permList } = await apiClient.get<{ list: Array<{ code: string }> }>(
      '/permissions?pageSize=100',
    )
    const userViewPerm = permList.list.find((p) => p.code === 'user:view')
    expect(userViewPerm).toBeTruthy()

    // 给临时角色配置 user:view 权限
    const { status } = await apiClient.put(`/role-permissions/role/${tempRoleId}`, {
      permissions: ['user:view'],
    })
    expect(status).toBe(200)

    // 验证角色权限已更新
    const { data: rolePerms } = await apiClient.get<string[]>(
      `/role-permissions/role/${tempRoleId}`,
    )
    expect(rolePerms).toContain('user:view')

    // 用户登录后应拥有 user:view 权限
    const loginRes = await rawLogin(tempUsername, 'e2e-password-123')
    expect(loginRes.user.permissions).toContain('user:view')
  })

  test('清空角色权限 → 用户登录后无该权限', async () => {
    // 先确认有权限
    const { data: before } = await apiClient.get<string[]>(`/role-permissions/role/${tempRoleId}`)
    expect(before).toContain('user:view')

    // 清空权限
    const { status } = await apiClient.put(`/role-permissions/role/${tempRoleId}`, {
      permissions: [],
    })
    expect(status).toBe(200)

    // 验证已清空
    const { data: after } = await apiClient.get<string[]>(`/role-permissions/role/${tempRoleId}`)
    expect(after).toHaveLength(0)

    // 用户登录后应无 user:view 权限
    const loginRes = await rawLogin(tempUsername, 'e2e-password-123')
    expect(loginRes.user.permissions ?? []).not.toContain('user:view')
  })

  test('删除角色时被用户引用 → 409', async () => {
    // tempRoleId 仍被临时用户引用，删除应返回 409
    // HttpExceptionFilter 响应格式 { code, message, data: null }，message 在顶层不在 data 内
    const { status } = await apiClient.delete(`/roles/${tempRoleId}`)
    expect(status).toBe(409)
  })

  test('PUT /role-permissions 给不存在的角色 → 404', async () => {
    const { status } = await apiClient.put('/role-permissions/role/999999', {
      permissions: [],
    })
    expect(status).toBe(404)
  })
})

test.describe('角色守卫（普通用户越权防护）', () => {
  // 用独立 token，避免污染 apiClient 的 admin token
  let normalToken: string | null = null

  test.beforeAll(async () => {
    const loginRes = await rawLogin(normalUser.username, normalUser.password)
    normalToken = loginRes.accessToken
  })

  test('普通用户 GET /role-permissions → 403', async () => {
    const res = await fetch(`${E2E_API_BASE}/role-permissions`, {
      headers: { Authorization: `Bearer ${normalToken}` },
    })
    expect(res.status).toBe(403)
  })

  test('普通用户 GET /role-permissions/role/:roleId → 403', async () => {
    const res = await fetch(`${E2E_API_BASE}/role-permissions/role/1`, {
      headers: { Authorization: `Bearer ${normalToken}` },
    })
    expect(res.status).toBe(403)
  })

  test('普通用户 PUT /role-permissions/role/:roleId → 403', async () => {
    const res = await fetch(`${E2E_API_BASE}/role-permissions/role/1`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalToken}`,
      },
      body: JSON.stringify({ permissions: [] }),
    })
    expect(res.status).toBe(403)
  })
})
