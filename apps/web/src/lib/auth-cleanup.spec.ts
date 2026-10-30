import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/auth-store'
import { bindCrossTabAuthSync, clearUserScopedState, setQueryClientForAuth } from './auth-cleanup'

const AUTH_KEY = 'auth-storage'

function persistedState(state: Record<string, unknown>): string {
  return JSON.stringify({ state, version: 0 })
}

function dispatchStorage(key: string | null, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

describe('bindCrossTabAuthSync（M7 跨 tab 登出/换号广播）', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient()
    setQueryClientForAuth(queryClient)
    vi.spyOn(queryClient, 'clear')
    useAuthStore.setState({
      user: { id: 1, username: 'alice' } as never,
      token: 'tok-1',
      isAuthenticated: true,
    })
    // 幂等注册：多次调用只绑一个监听
    bindCrossTabAuthSync()
    bindCrossTabAuthSync()
  })

  it('另一 tab 登出 → 本 tab 同步清态并清 query 缓存', () => {
    dispatchStorage(AUTH_KEY, persistedState({ user: null, token: null, isAuthenticated: false }))

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().token).toBeNull()
    expect(queryClient.clear).toHaveBeenCalled()
  })

  it('另一 tab 换号登录 → 本 tab 清上一用户数据', () => {
    dispatchStorage(
      AUTH_KEY,
      persistedState({ user: { id: 2, username: 'bob' }, token: 'tok-2', isAuthenticated: true }),
    )

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(queryClient.clear).toHaveBeenCalled()
  })

  it('同账号 token 轮换 → 不干预（不误登出）', () => {
    dispatchStorage(
      AUTH_KEY,
      persistedState({
        user: { id: 1, username: 'alice' },
        token: 'tok-rotated',
        isAuthenticated: true,
      }),
    )

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().token).toBe('tok-1')
    expect(queryClient.clear).not.toHaveBeenCalled()
  })

  it('整仓 clear（key 为 null）→ 按登出清态', () => {
    dispatchStorage(null, null)

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('无关 key 的 storage 事件不触发', () => {
    dispatchStorage('some-other-key', null)

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(queryClient.clear).not.toHaveBeenCalled()
  })

  it('本 tab 已登出 → 幂等无操作', () => {
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false })

    dispatchStorage(
      AUTH_KEY,
      persistedState({ user: { id: 2 }, token: 'tok-2', isAuthenticated: true }),
    )

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('无法解析的 newValue → fail-closed 清态', () => {
    dispatchStorage(AUTH_KEY, 'not-json{{{')

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

describe('clearUserScopedState', () => {
  it('清 zustand 认证态与 query 缓存', () => {
    const qc = new QueryClient()
    setQueryClientForAuth(qc)
    const spy = vi.spyOn(qc, 'clear')
    useAuthStore.setState({ isAuthenticated: true, token: 'tok', user: { id: 1 } as never })

    clearUserScopedState()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(spy).toHaveBeenCalled()
    setQueryClientForAuth(null)
  })

  // 从原 hooks/use-auth.spec.ts 迁入（该文件实为 auth-cleanup 用例，已按实际被测对象归档）
  it('未注册 queryClient 时不抛异常（登出流程不应因清理失败而中断）', () => {
    setQueryClientForAuth(null)
    useAuthStore.getState().login({ id: 1, username: 'alice' } as never, 'token-alice')

    expect(() => clearUserScopedState()).not.toThrow()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
