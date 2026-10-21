import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock hoist 约束：共享可变状态放 vi.hoisted
const state = vi.hoisted(() => ({
  // 当前用例授予的权限码集合（useCan 按此判定）
  granted: [] as string[],
  // /auth/me 回显（L8 自改判定 + 行级 admin 展示）
  me: { id: 7, adminRoleId: 1 } as { id: number; adminRoleId: number },
  deleteCalls: [] as { id: number; resolve: () => void }[],
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  const messageApi = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    open: vi.fn(),
    destroy: vi.fn(),
  }
  return {
    ...actual,
    message: Object.assign(() => {}, actual.message, {
      useMessage: () => [messageApi, null],
    }),
  }
})

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
  const third = { ...other, id: 3, username: 'third', email: 't@example.com', nickname: 'Third' }
  const pendingDelete = (id: number) =>
    new Promise<void>((resolve) => state.deleteCalls.push({ id, resolve }))
  return {
    useUsers: () => ({
      data: { list: [other, self, third], total: 3 },
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
    }),
    useCreateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteUser: () => ({ mutateAsync: pendingDelete, isPending: false }),
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

describe('L6：用户行级并发', () => {
  beforeEach(() => {
    state.granted = [PermissionCodes.USER_DELETE]
    state.me = { id: 7, adminRoleId: 1 }
    state.deleteCalls = []
  })

  it('双行删除并发，A 完成不清 B 的 loading', async () => {
    render(
      <ConfigProvider locale={zhCN}>
        <UsersContent />
      </ConfigProvider>,
    )

    const rowA = screen.getByText('other').closest('tr') as HTMLElement
    const rowB = screen.getByText('third').closest('tr') as HTMLElement
    fireEvent.click(within(rowA).getByRole('button', { name: /禁\s*用/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /确\s*定/ }).at(-1) as HTMLElement)
    fireEvent.click(within(rowB).getByRole('button', { name: /禁\s*用/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /确\s*定/ }).at(-1) as HTMLElement)

    await waitFor(() => {
      expect(within(rowA).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')
      expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')
    })

    await act(async () => {
      state.deleteCalls.find((call) => call.id === 2)?.resolve()
    })

    await waitFor(() => {
      expect(within(rowA).getByRole('button', { name: /禁\s*用/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
    expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')

    await act(async () => {
      state.deleteCalls.find((call) => call.id === 3)?.resolve()
    })
    await waitFor(() => {
      expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
  })
})
