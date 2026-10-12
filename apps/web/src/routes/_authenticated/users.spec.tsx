import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock hoist 约束：共享可变状态放 vi.hoisted
const state = vi.hoisted(() => ({
  // 当前用例授予的权限码集合（useCan 按此判定）
  granted: [] as string[],
  // /auth/me 回显（L8 自改判定 + 行级 admin 展示）
  me: { id: 7, adminRoleId: 1 } as { id: number; adminRoleId: number },
}))

vi.mock('@/hooks/use-auth', () => ({
  useCan: () => (code: string) => state.granted.includes(code),
  useCurrentUser: () => ({ data: state.me }),
}))

vi.mock('@/hooks/use-roles', () => ({
  useAllRoles: () => ({ data: [{ id: 2, name: 'user' }], isLoading: false }),
}))

vi.mock('@/hooks/use-paged-fallback', () => ({
  usePagedFallback: () => {},
}))

vi.mock('@/hooks/use-users', () => {
  const other = {
    id: 2,
    username: 'other',
    email: 'o@example.com',
    nickname: 'Other',
    phone: null,
    roleId: 2,
    status: true,
    deletedAt: null,
    roles: [{ id: 2, name: 'user' }],
  }
  const self = { ...other, id: 7, username: 'me', email: 'm@example.com', nickname: 'Me' }
  return {
    useUsers: () => ({
      data: { list: [other, self], total: 2 },
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
    }),
    useCreateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRestoreUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

import { PermissionCodes } from '@/lib/permissions'
import { UsersContent } from './users'

async function openEditModal(rowIndex: number) {
  const editButtons = await screen.findAllByRole('button', { name: '编辑' })
  // 可选链：缺行时后续 findByLabelText 超时会给出明确失败
  editButtons[rowIndex]?.click()
  return screen.findByLabelText('新密码')
}

describe('L8：编辑弹窗新密码输入框按后端 403 条件禁用', () => {
  beforeEach(() => {
    state.granted = [PermissionCodes.USER_UPDATE]
    state.me = { id: 7, adminRoleId: 1 }
  })

  it('无 user:role_manage 编辑他人 → 密码框禁用（修复前可填并提交，必收 403）', async () => {
    render(<UsersContent />)

    const input = await openEditModal(0)
    expect(input).toBeDisabled()
  })

  it('持 user:role_manage 编辑他人 → 密码框可用（正常代改密）', async () => {
    state.granted = [PermissionCodes.USER_UPDATE, PermissionCodes.USER_ROLE_MANAGE]
    render(<UsersContent />)

    const input = await openEditModal(0)
    expect(input).toBeEnabled()
  })

  it('编辑自己 → 密码框禁用（改自己密码必须走 /me/password）', async () => {
    state.granted = [PermissionCodes.USER_UPDATE, PermissionCodes.USER_ROLE_MANAGE]
    render(<UsersContent />)

    const input = await openEditModal(1)
    expect(input).toBeDisabled()
  })
})
