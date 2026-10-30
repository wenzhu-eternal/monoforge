import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  redirect: vi.fn((opts: unknown) => Object.assign(new Error('redirect'), { redirectOpts: opts })),
}))

import { PermissionCodes } from '@/lib/permissions'
import { useAuthStore } from '@/store/auth-store'
import { getRequiredPermission, requireAuth } from './route-guards'

describe('getRequiredPermission', () => {
  it('精确路径与子路径都映射到同一权限码', () => {
    expect(getRequiredPermission('/users')).toBe(PermissionCodes.USER_VIEW)
    expect(getRequiredPermission('/users/123')).toBe(PermissionCodes.USER_VIEW)
  })

  it('无权限要求的路径返回 undefined（如 dashboard）', () => {
    expect(getRequiredPermission('/dashboard')).toBeUndefined()
  })

  it('前缀不得误匹配（/usersx 不命中 /users）', () => {
    expect(getRequiredPermission('/usersx')).toBeUndefined()
  })
})

describe('requireAuth', () => {
  it('未认证或 token 缺失时抛出重定向到 /login', () => {
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false })

    expect(() => requireAuth()()).toThrow()
  })

  it('已认证且 token 存在时放行', () => {
    useAuthStore.setState({ user: { id: 1 } as never, token: 'tok', isAuthenticated: true })

    expect(() => requireAuth()()).not.toThrow()
  })
})
