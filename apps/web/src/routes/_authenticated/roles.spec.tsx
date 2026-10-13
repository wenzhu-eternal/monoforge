import { render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock hoist 约束：可变状态放 vi.hoisted；每例 preset 后 render（无外部触发重渲染需求）
const state = vi.hoisted(() => ({
  permsQuery: { data: undefined as string[] | undefined, isFetching: true },
}))

vi.mock('@/hooks/use-auth', () => ({
  useCan: () => () => true,
}))

vi.mock('@/hooks/use-paged-fallback', () => ({
  usePagedFallback: () => {},
}))

vi.mock('@/hooks/use-roles', () => ({
  useRoles: () => ({
    data: { list: [{ id: 3, name: 'editor', description: null, deletedAt: null }], total: 1 },
    isLoading: false,
    isError: false,
    error: null,
    isSuccess: true,
  }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRestoreRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/use-permissions', () => ({
  useAllPermissions: () => ({
    data: [
      { code: 'user:view', name: '用户查看' },
      { code: 'role:view', name: '角色查看' },
    ],
    isLoading: false,
  }),
  useRolePermissions: () => state.permsQuery,
  useUpdateRolePermissions: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { RolesContent } from './roles'

async function openPermissionModal() {
  render(
    <ConfigProvider locale={zhCN}>
      <RolesContent />
    </ConfigProvider>,
  )
  const openButtons = await screen.findAllByRole('button', { name: '配置权限' })
  openButtons[0]?.click()
  // 等弹窗（含勾选项）渲染完成
  await screen.findByRole('checkbox', { name: /user:view/ })
}

describe('L10：配置权限弹窗回显竞态防护', () => {
  beforeEach(() => {
    state.permsQuery = { data: undefined, isFetching: true }
  })

  it('L10：回显未到（首次打开 fetching）时勾选与确定禁用（修复前可勾可提交，晚到数据覆盖后静默丢失）', async () => {
    await openPermissionModal()

    expect(screen.getByRole('checkbox', { name: /user:view/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /role:view/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '全选' })).toBeDisabled()
    // antd 两字按钮自动插空格，且 confirmLoading 时可访问名带 "loading" 前缀
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled()
  })

  it('回显已到 → 勾选与确定恢复可用（控制组）', async () => {
    state.permsQuery = { data: ['user:view'], isFetching: false }
    await openPermissionModal()

    expect(screen.getByRole('checkbox', { name: /user:view/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeEnabled()
    // 已回显勾选：user:view 为 checked（effect 同步后）
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /user:view/ })).toBeChecked())
  })
})
