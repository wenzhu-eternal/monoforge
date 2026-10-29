import { normalUser, targetUser } from '@e2e/fixtures/users'
import { apiClient } from './api'

/**
 * 数据清理辅助：在测试间清理 e2e 创建的数据
 *
 * 策略：用户名前缀 `e2e_`（UsernameSchema 禁用连字符）+ 文件/角色前缀 `e2e-`
 * 不删除 admin 账号和 seed 创建的默认数据
 * 不删除 normalUser/targetUser 夹具账号（由 global-setup 创建，长期复用）
 */

const E2E_PREFIX = 'e2e-'
const E2E_USER_PREFIX = 'e2e_'

// 夹具账号：global-setup 创建后长期复用，cleanup 不应清理
const PROTECTED_USERS: Set<string> = new Set([normalUser.username, targetUser.username])

/**
 * 分页拉取全量列表（单页 100 条会截断，残留数据跨轮次累积）
 */
export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const all: T[] = []
  const pageSize = 100
  let page = 1
  for (;;) {
    const { data } = await apiClient.get<{ list: T[]; total: number }>(
      `${path}?page=${page}&pageSize=${pageSize}`,
    )
    all.push(...data.list)
    if (all.length >= data.total || data.list.length === 0) break
    page++
  }
  return all
}

/**
 * 按角色名查询角色 id（动态查询，避免写死 seed 顺序）
 */
export async function findRoleId(roleName: string): Promise<number | undefined> {
  const roles = await fetchAllPages<{ id: number; name: string }>('/roles')
  return roles.find((r) => r.name === roleName)?.id
}

/**
 * 清理所有 e2e 前缀的临时用户（排除夹具账号 normalUser/targetUser；
 * 同时匹配 e2e_ 与历史 e2e- 前缀，兼容旧残留数据）
 */
export async function cleanupTempUsers() {
  const users = await fetchAllPages<{ id: number; username: string }>('/users')

  const tempUsers = users.filter(
    (u) =>
      (u.username.startsWith(E2E_USER_PREFIX) || u.username.startsWith(E2E_PREFIX)) &&
      !PROTECTED_USERS.has(u.username),
  )
  for (const user of tempUsers) {
    await apiClient.delete(`/users/${user.id}`).catch(() => {})
  }
}

/**
 * 清理所有 e2e- 前缀的临时文件记录
 * 注意：磁盘文件移到 uploads-trash 后由运维清理，e2e 不负责清理磁盘
 */
export async function cleanupTempFiles() {
  const files = await fetchAllPages<{ id: number; originalName: string }>('/files')

  const tempFiles = files.filter((f) => f.originalName.startsWith(E2E_PREFIX))
  for (const file of tempFiles) {
    await apiClient.delete(`/files/${file.id}`).catch(() => {})
  }
}

/**
 * 清理所有 e2e- 前缀的临时角色
 */
export async function cleanupTempRoles() {
  const roles = await fetchAllPages<{ id: number; name: string }>('/roles')

  const tempRoles = roles.filter((r) => r.name.startsWith(E2E_PREFIX))
  for (const role of tempRoles) {
    await apiClient.delete(`/roles/${role.id}`).catch(() => {})
  }
}

/**
 * 清理所有 e2e 前缀的临时权限（兼容 e2e: 和 e2e_ 两种前缀）
 */
export async function cleanupTempPermissions() {
  const perms = await fetchAllPages<{ id: number; code: string }>('/permissions')

  const tempPerms = perms.filter((p) => p.code.startsWith('e2e:') || p.code.startsWith('e2e_'))
  for (const perm of tempPerms) {
    await apiClient.delete(`/permissions/${perm.id}`).catch(() => {})
  }
}

/**
 * 清理 e2e- 前缀的临时错误白名单规则（L26）
 * 白名单 Tab 不分页，跨轮次残留会无限堆积并淹没统计
 */
export async function cleanupTempWhitelists() {
  const { data } =
    await apiClient.get<Array<{ id: number; pattern: string }>>('/error-logs/whitelist')
  const list = Array.isArray(data) ? data : []
  for (const item of list.filter((w) => w.pattern.startsWith(E2E_PREFIX))) {
    await apiClient.delete(`/error-logs/whitelist/${item.id}`).catch(() => {})
  }
}

/**
 * 清理 e2e- 前缀的临时错误日志（L26）——错误统计不被 e2e 噪音逐轮淹没
 */
export async function cleanupTempErrorLogs() {
  const logs = await fetchAllPages<{ id: number; message: string }>('/error-logs')
  for (const log of logs.filter((l) => l.message.startsWith(E2E_PREFIX))) {
    await apiClient.delete(`/error-logs/${log.id}`).catch(() => {})
  }
}

/**
 * 全量清理（global-teardown 调用）
 */
export async function cleanupAll() {
  await cleanupTempFiles().catch(() => {})
  await cleanupTempUsers().catch(() => {})
  await cleanupTempRoles().catch(() => {})
  await cleanupTempPermissions().catch(() => {})
  await cleanupTempWhitelists().catch(() => {})
  await cleanupTempErrorLogs().catch(() => {})
}
