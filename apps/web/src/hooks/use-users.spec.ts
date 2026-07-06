import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 被 hoist，需用 vi.hoisted 创建 mock 对象
const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

import { renderHookWithQuery, waitFor } from '@/test/utils'
import { useCreateUser, useDeleteUser, useUpdateUser, useUser, useUsers } from './use-users'

describe('use-users hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useUsers', () => {
    it('请求用户列表并返回数据', async () => {
      const mockData = {
        list: [{ id: 1, username: 'admin' }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }
      apiMock.get.mockResolvedValue({
        data: { code: 200, message: 'ok', data: mockData },
      })

      const { result } = renderHookWithQuery(() =>
        useUsers({ page: 1, pageSize: 10, order: 'desc' }),
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockData)
      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/users', {
        params: { page: 1, pageSize: 10, order: 'desc' },
      })
    })

    it('请求失败时进入 error 状态', async () => {
      apiMock.get.mockRejectedValue(new Error('网络错误'))

      const { result } = renderHookWithQuery(() =>
        useUsers({ page: 1, pageSize: 10, order: 'desc' }),
      )

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.data).toBeUndefined()
    })
  })

  describe('useUser', () => {
    it('id 为 0 时不发起请求', () => {
      const { result } = renderHookWithQuery(() => useUser(0))
      expect(result.current.fetchStatus).toBe('idle')
      expect(apiMock.get).not.toHaveBeenCalled()
    })

    it('按 ID 请求用户详情', async () => {
      const mockUser = { id: 1, username: 'admin' }
      apiMock.get.mockResolvedValue({ data: { code: 200, data: mockUser } })

      const { result } = renderHookWithQuery(() => useUser(1))

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockUser)
      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/users/1')
    })
  })

  describe('useCreateUser', () => {
    it('创建用户成功', async () => {
      const newUser = { id: 3, username: 'newuser' }
      apiMock.post.mockResolvedValue({ data: { code: 200, data: newUser } })

      const { result } = renderHookWithQuery(() => useCreateUser())

      const payload = {
        username: 'newuser',
        email: 'n@t.com',
        password: 'Pass1234',
        roleId: 2,
      }
      await result.current.mutateAsync(payload)

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/users', payload)
    })
  })

  describe('useUpdateUser', () => {
    it('更新用户成功', async () => {
      apiMock.patch.mockResolvedValue({ data: { code: 200, data: { id: 1 } } })

      const { result } = renderHookWithQuery(() => useUpdateUser())

      const updateData = {
        email: 'new@t.com',
        roleId: 2,
        nickname: '新昵称',
      }
      await result.current.mutateAsync({ id: 1, data: updateData })

      expect(apiMock.patch).toHaveBeenCalledWith('/api/v1/users/1', updateData)
    })
  })

  describe('useDeleteUser', () => {
    it('删除用户成功', async () => {
      apiMock.delete.mockResolvedValue({ data: { code: 200 } })

      const { result } = renderHookWithQuery(() => useDeleteUser())

      await result.current.mutateAsync(1)

      expect(apiMock.delete).toHaveBeenCalledWith('/api/v1/users/1')
    })
  })
})
