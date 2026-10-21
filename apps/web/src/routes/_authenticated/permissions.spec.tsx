import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PendingCall = {
  id: number
  resolve: () => void
  reject: (error: unknown) => void
}

const state = vi.hoisted(() => ({
  routes: {
    data: [] as { method: string; path: string; controller: string; handlerName: string }[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  deleteCalls: [] as PendingCall[],
  restoreCalls: [] as PendingCall[],
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
  useCan: () => () => true,
}))

vi.mock('@/hooks/use-paged-fallback', () => ({
  usePagedFallback: () => {},
}))

vi.mock('@/hooks/use-permissions', () => {
  const permissions = [
    {
      id: 21,
      code: 'user:view',
      name: '用户查看',
      description: null,
      routes: ['GET /api/v1/users'],
      deletedAt: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: 22,
      code: 'role:view',
      name: '角色查看',
      description: null,
      routes: ['GET /api/v1/roles'],
      deletedAt: null,
      createdAt: new Date().toISOString(),
    },
  ]

  const pendingMutation = (calls: PendingCall[]) => ({
    isPending: false,
    mutateAsync: (arg: number | { id: number }) =>
      new Promise<void>((resolve, reject) =>
        calls.push({ id: typeof arg === 'number' ? arg : arg.id, resolve, reject }),
      ),
  })

  return {
    usePermissions: () => ({
      data: { list: permissions, total: permissions.length },
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
    }),
    useRoutes: () => state.routes,
    useCreatePermission: () => ({ isPending: false, mutateAsync: vi.fn() }),
    useUpdatePermission: () => ({ isPending: false, mutateAsync: vi.fn() }),
    useDeletePermission: () => pendingMutation(state.deleteCalls),
    useRestorePermission: () => pendingMutation(state.restoreCalls),
  }
})

import { PermissionCodesContent } from './permissions'

function renderPage() {
  return render(
    <ConfigProvider locale={zhCN}>
      <PermissionCodesContent />
    </ConfigProvider>,
  )
}

function rowFor(text: string): HTMLElement {
  const cell = screen.getByText(text)
  const row = cell.closest('tr')
  if (!row) throw new Error(`未找到 ${text} 所在行`)
  return row
}

function confirmLastPopconfirm() {
  const buttons = screen.getAllByRole('button', { name: /确\s*定/ })
  const button = buttons.at(-1)
  if (!button) throw new Error('未找到确认按钮')
  fireEvent.click(button)
}

describe('L5/L6：权限管理页面', () => {
  beforeEach(() => {
    state.routes = { data: [], isLoading: false, isError: false, error: null }
    state.deleteCalls = []
    state.restoreCalls = []
  })

  it('L5：路由加载中禁止保存配置', () => {
    state.routes = { data: [], isLoading: true, isError: false, error: null }
    renderPage()

    fireEvent.click(within(rowFor('user:view')).getByRole('button', { name: '配置路由' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('路由加载中...')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /确\s*定/ })).toBeDisabled()
  })

  it('L5：路由加载失败展示 Alert 并禁止保存配置', () => {
    state.routes = {
      data: [],
      isLoading: false,
      isError: true,
      error: new Error('routes unavailable'),
    }
    renderPage()

    fireEvent.click(within(rowFor('user:view')).getByRole('button', { name: '配置路由' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('路由清单加载失败')
    expect(within(dialog).getByRole('button', { name: /确\s*定/ })).toBeDisabled()
  })

  it('L6：双行删除并发，A 完成不清 B 的 loading', async () => {
    renderPage()

    const rowA = rowFor('user:view')
    const rowB = rowFor('role:view')
    fireEvent.click(within(rowA).getByRole('button', { name: /禁\s*用/ }))
    confirmLastPopconfirm()
    fireEvent.click(within(rowB).getByRole('button', { name: /禁\s*用/ }))
    confirmLastPopconfirm()

    await waitFor(() => {
      expect(within(rowA).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')
      expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')
    })

    await act(async () => {
      state.deleteCalls.find((call) => call.id === 21)?.resolve()
    })

    await waitFor(() => {
      expect(within(rowA).getByRole('button', { name: /禁\s*用/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
    expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')

    await act(async () => {
      state.deleteCalls.find((call) => call.id === 22)?.resolve()
    })
    await waitFor(() => {
      expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
  })
})
