/**
 * 测试账号夹具
 *
 * admin 账号来自 seed.ts（password: 888888）
 * 普通用户账号由 global-setup 创建（绕过注册流程，不依赖 mail 服务）
 */

export const E2E_API_BASE = 'http://localhost:9000/api/v1'

export const adminUser = {
  username: 'admin',
  password: '888888',
  email: 'admin@example.com',
} as const

export const normalUser = {
  // 用户名遵守 UsernameSchema（仅字母/数字/下划线），故用下划线分隔
  username: 'e2e_normal_user',
  password: 'e2e-password-123',
  email: 'e2e-normal@test.com',
  nickname: 'e2e 普通用户',
} as const

/**
 * 用于测试「创建用户」时使用的临时账号前缀，避免冲突
 */
export const tempUserPrefix = 'e2e_temp'

/**
 * 用于测试「改角色/状态防提权」的目标用户
 */
export const targetUser = {
  username: 'e2e_target_user',
  password: 'e2e-password-123',
  email: 'e2e-target@test.com',
  nickname: 'e2e 目标用户',
} as const
