import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 被 hoist，需用 vi.hoisted 创建 mock 对象
const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

import { useAuthStore } from '@/store/auth-store'
import { renderHookWithQuery, waitFor } from '@/test/utils'
import { useAllRoles } from './use-roles'

describe('useAllRoles（M5 门控）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 无 token → useCurrentUser 停用，meUser undefined，can 走 store 兜底
    useAuthStore.setState({ user: null, token: null })
  })

  it('无 role:view 权限 → 不发请求（防 GET /roles 403 整页踢 /403）', () => {
    useAuthStore.setState({ user: { id: 2, permissions: ['user:view'] } as never })

    const { result } = renderHookWithQuery(() => useAllRoles())

    expect(result.current.fetchStatus).toBe('idle')
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('me 未加载且 store 无用户 → 默认拒绝不发请求', () => {
    const { result } = renderHookWithQuery(() => useAllRoles())

    expect(result.current.fetchStatus).toBe('idle')
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('持 role:view → 正常逐页拉取', async () => {
    useAuthStore.setState({ user: { id: 1, permissions: ['role:view'] } as never })
    apiMock.get.mockResolvedValue({
      data: { code: 200, data: { list: [{ id: 1, name: 'admin' }], total: 1 } },
    })

    const { result } = renderHookWithQuery(() => useAllRoles())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiMock.get).toHaveBeenCalledWith('/api/v1/roles', {
      params: { page: 1, pageSize: 100 },
    })
  })
})
