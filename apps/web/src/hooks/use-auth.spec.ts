import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

import { clearUserScopedState, setQueryClientForAuth } from '@/lib/auth-cleanup'
import { useAuthStore } from '@/store/auth-store'

describe('登出时的跨账号数据隔离', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    setQueryClientForAuth(queryClient)
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
  })

  it('clearUserScopedState 必须清空 React Query 缓存，防止下一个登录用户读到上一个用户的数据', () => {
    useAuthStore.getState().login({ id: 1, username: 'alice' } as never, 'token-alice')
    queryClient.setQueryData(['users'], [{ id: 1, username: 'alice-private-data' }])
    queryClient.setQueryData(['files'], [{ id: 10, name: 'alice-secret.pdf' }])
    queryClient.setQueryData(['auth', 'me'], { id: 1, username: 'alice' })

    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0)

    clearUserScopedState()

    expect(queryClient.getQueryData(['users'])).toBeUndefined()
    expect(queryClient.getQueryData(['files'])).toBeUndefined()
    expect(queryClient.getQueryData(['auth', 'me'])).toBeUndefined()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('clearUserScopedState 同时清空 zustand 认证态', () => {
    useAuthStore.getState().login({ id: 1, username: 'alice' } as never, 'token-alice')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    clearUserScopedState()

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.token).toBeNull()
    expect(state.isAuthenticated).toBe(false)
  })

  it('未注册 queryClient 时不抛异常（登出流程不应因清理失败而中断）', () => {
    setQueryClientForAuth(null)
    useAuthStore.getState().login({ id: 1, username: 'alice' } as never, 'token-alice')

    expect(() => clearUserScopedState()).not.toThrow()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
