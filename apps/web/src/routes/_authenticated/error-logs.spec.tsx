import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PendingCall = {
  id: number
  resolve: () => void
  reject: (error: unknown) => void
}

const state = vi.hoisted(() => ({
  resolveCalls: [] as PendingCall[],
  updateCalls: [] as PendingCall[],
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

vi.mock('@/hooks/use-logs', () => {
  const logs = [
    {
      id: 1,
      source: 'frontend',
      errorType: 'js_error',
      isResolved: false,
      message: '错误 A',
      createdAt: new Date().toISOString(),
    },
    {
      id: 2,
      source: 'backend',
      errorType: 'http_error',
      isResolved: false,
      message: '错误 B',
      createdAt: new Date().toISOString(),
    },
  ]
  const whitelist = [
    {
      id: 11,
      pattern: 'ECONNRESET',
      matchType: 'message',
      description: null,
      isActive: true,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 12,
      pattern: '/api/v1/health',
      matchType: 'url',
      description: null,
      isActive: true,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    useErrorLogs: () => ({
      data: { list: logs, total: logs.length },
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
    }),
    useErrorStats: () => ({ data: undefined }),
    useErrorLogsGrouped: () => ({ data: [] }),
    useResolveErrorLog: () => pendingMutation(state.resolveCalls),
    useBatchResolveErrorLog: () => ({ isPending: false, mutateAsync: vi.fn() }),
    useDeleteErrorLog: () => ({ isPending: false, mutateAsync: vi.fn() }),
    useWhitelist: () => ({
      data: whitelist,
      isLoading: false,
      isError: false,
      error: null,
    }),
    useCreateWhitelist: () => ({ isPending: false, mutateAsync: vi.fn() }),
    useUpdateWhitelist: () => pendingMutation(state.updateCalls),
    useDeleteWhitelist: () => ({ isPending: false, mutateAsync: vi.fn() }),
    useRestoreWhitelist: () => ({ isPending: false, mutateAsync: vi.fn() }),
  }
})

import { LogsTab, WhitelistTab } from './error-logs'

function rowFor(text: string): HTMLElement {
  const cell = screen.getByText(text)
  const row = cell.closest('tr')
  if (!row) throw new Error(`未找到 ${text} 所在行`)
  return row
}

describe('L6：错误日志页面行级并发', () => {
  beforeEach(() => {
    state.resolveCalls = []
    state.updateCalls = []
  })

  it('LogsTab：A 在途点 B，各自 loading 独立，A 完成不清 B（L4）', async () => {
    render(<LogsTab />)

    const rowA = rowFor('错误 A')
    const rowB = rowFor('错误 B')
    fireEvent.click(within(rowA).getByRole('button', { name: /标记已处理/ }))
    fireEvent.click(within(rowB).getByRole('button', { name: /标记已处理/ }))

    await waitFor(() => {
      expect(within(rowA).getByRole('button', { name: /标记已处理/ })).toHaveClass(
        'ant-btn-loading',
      )
      expect(within(rowB).getByRole('button', { name: /标记已处理/ })).toHaveClass(
        'ant-btn-loading',
      )
    })

    await act(async () => {
      state.resolveCalls.find((call) => call.id === 1)?.resolve()
    })

    await waitFor(() => {
      expect(within(rowA).getByRole('button', { name: /标记已处理/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
    expect(within(rowB).getByRole('button', { name: /标记已处理/ })).toHaveClass('ant-btn-loading')

    await act(async () => {
      state.resolveCalls.find((call) => call.id === 2)?.resolve()
    })
    await waitFor(() => {
      expect(within(rowB).getByRole('button', { name: /标记已处理/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
  })

  it('WhitelistTab：同行开关与删除共享 pending，行间互不影响', async () => {
    render(<WhitelistTab />)

    const rowA = rowFor('ECONNRESET')
    const rowB = rowFor('/api/v1/health')
    fireEvent.click(within(rowA).getByRole('switch'))
    fireEvent.click(within(rowB).getByRole('switch'))

    await waitFor(() => {
      expect(within(rowA).getByRole('switch')).toHaveClass('ant-switch-loading')
      expect(within(rowA).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')
      expect(within(rowB).getByRole('switch')).toHaveClass('ant-switch-loading')
    })

    await act(async () => {
      state.updateCalls.find((call) => call.id === 11)?.resolve()
    })

    await waitFor(() => {
      expect(within(rowA).getByRole('switch')).not.toHaveClass('ant-switch-loading')
      expect(within(rowA).getByRole('button', { name: /禁\s*用/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
    expect(within(rowB).getByRole('switch')).toHaveClass('ant-switch-loading')

    await act(async () => {
      state.updateCalls.find((call) => call.id === 12)?.resolve()
    })
    await waitFor(() => {
      expect(within(rowB).getByRole('switch')).not.toHaveClass('ant-switch-loading')
    })
  })
})
