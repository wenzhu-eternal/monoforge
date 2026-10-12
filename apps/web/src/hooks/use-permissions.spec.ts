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
import { useAllPermissions, useRolePermissions } from './use-permissions'

describe('use-permissions 辅助查询（M5 门控）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: null, token: null })
  })

  it('无 permission:view → useAllPermissions 不发请求', () => {
    useAuthStore.setState({ user: { id: 2, permissions: ['role:view'] } as never })

    const { result } = renderHookWithQuery(() => useAllPermissions())

    expect(result.current.fetchStatus).toBe('idle')
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('无 permission:view → useRolePermissions 不发请求', () => {
    useAuthStore.setState({ user: { id: 2, permissions: ['role:view'] } as never })

    const { result } = renderHookWithQuery(() => useRolePermissions(1))

    expect(result.current.fetchStatus).toBe('idle')
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('roleId=0 → 不发请求（保留原门控）', () => {
    useAuthStore.setState({ user: { id: 1, permissions: ['permission:view'] } as never })

    const { result } = renderHookWithQuery(() => useRolePermissions(0))

    expect(result.current.fetchStatus).toBe('idle')
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('持 permission:view → 两个查询正常发起', async () => {
    useAuthStore.setState({ user: { id: 1, permissions: ['permission:view'] } as never })
    apiMock.get.mockResolvedValue({ data: { code: 200, data: [{ code: 'user:view' }] } })

    const all = renderHookWithQuery(() => useAllPermissions())
    const byRole = renderHookWithQuery(() => useRolePermissions(5))

    await waitFor(() => expect(all.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(byRole.result.current.isSuccess).toBe(true))
    expect(apiMock.get).toHaveBeenCalledWith('/api/v1/permissions/list')
    expect(apiMock.get).toHaveBeenCalledWith('/api/v1/role-permissions/role/5')
  })
})
