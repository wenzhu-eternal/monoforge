import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock, cleanupMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  cleanupMock: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/lib/auth-cleanup', () => ({ clearUserScopedState: cleanupMock }))

import { useAuthStore } from '@/store/auth-store'
import { renderHookWithQuery, waitFor } from '@/test/utils'
import { useCan, useChangePassword, useCurrentUser, useLogin, useLogout } from './use-auth'

describe('use-auth hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
  })

  describe('useLogin', () => {
    it('登录成功写入 store 的 user/token', async () => {
      apiMock.post.mockResolvedValue({
        data: {
          code: 200,
          message: 'ok',
          data: {
            accessToken: 'at-1',
            user: { id: 9, username: 'u', permissions: ['user:view'] },
          },
        },
      })
      const { result } = renderHookWithQuery(() => useLogin())

      await act(async () => {
        await result.current.mutateAsync({ username: 'u', password: 'p' } as never)
      })

      expect(useAuthStore.getState().token).toBe('at-1')
      expect(useAuthStore.getState().user?.id).toBe(9)
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
  })

  describe('useLogout', () => {
    it('后端登出失败仍清前端态（不阻断登出）', async () => {
      apiMock.post.mockRejectedValue(new Error('network down'))
      const { result } = renderHookWithQuery(() => useLogout())

      await act(async () => {
        await result.current.mutateAsync()
      })

      expect(cleanupMock).toHaveBeenCalled()
    })
  })

  describe('useCan', () => {
    it('me 未加载时以 store 权限兜底', () => {
      useAuthStore.setState({
        user: { id: 1, permissions: ['user:view'] } as never,
        token: null,
        isAuthenticated: false,
      })
      const { result } = renderHookWithQuery(() => useCan())

      expect(result.current('user:view')).toBe(true)
      expect(result.current('user:delete')).toBe(false)
    })

    it('me 已加载时以最新 me 权限为准（store 旧值不覆盖）', async () => {
      apiMock.get.mockResolvedValue({
        data: { code: 200, message: 'ok', data: { id: 1, permissions: ['user:view'] } },
      })
      useAuthStore.setState({
        user: { id: 1, permissions: ['user:delete'] } as never,
        token: 'tok',
        isAuthenticated: true,
      })
      const { result } = renderHookWithQuery(() => useCan())

      await waitFor(() => expect(result.current('user:view')).toBe(true))
      expect(result.current('user:delete')).toBe(false)
    })
  })

  describe('useCurrentUser / useChangePassword', () => {
    it('useCurrentUser 在无 token 时禁用请求', () => {
      const { result } = renderHookWithQuery(() => useCurrentUser())

      expect(result.current.fetchStatus).toBe('idle')
      expect(apiMock.get).not.toHaveBeenCalled()
    })

    it('useChangePassword 提交到 /users/me/password', async () => {
      apiMock.post.mockResolvedValue({
        data: { code: 200, message: 'ok', data: { message: 'ok' } },
      })
      const { result } = renderHookWithQuery(() => useChangePassword())

      await act(async () => {
        await result.current.mutateAsync({ oldPassword: 'a', newPassword: 'b' } as never)
      })

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/users/me/password', {
        oldPassword: 'a',
        newPassword: 'b',
      })
    })
  })
})
