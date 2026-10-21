import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock hoist 约束：共享可变状态放 vi.hoisted
const state = vi.hoisted(() => ({
  granted: [] as string[],
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
}))

vi.mock('@/hooks/use-paged-fallback', () => ({
  usePagedFallback: () => {},
}))

vi.mock('@/hooks/use-files', () => {
  const imageFile = {
    id: 1,
    filename: 'a.png',
    originalName: 'a.png',
    mimeType: 'image/png',
    size: 1024,
    uploadedBy: 7,
    uploadedByUsername: 'me',
    deletedAt: null,
    createdAt: new Date().toISOString(),
  }
  const secondFile = { ...imageFile, id: 2, filename: 'b.png', originalName: 'b.png' }
  return {
    useFiles: () => ({
      data: { list: [imageFile, secondFile], total: 2 },
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
    }),
    useUploadFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteFile: () => ({
      mutateAsync: (id: number) =>
        new Promise<void>((resolve) => state.deleteCalls.push({ id, resolve })),
      isPending: false,
    }),
    useRestoreFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
    previewFile: vi.fn().mockResolvedValue('blob:mock-preview-url'),
    downloadFile: vi.fn(),
  }
})

import { previewFile } from '@/hooks/use-files'
import { PermissionCodes } from '@/lib/permissions'
import { FilesContent } from './files'

describe('M10：StrictMode 双挂载下预览仍可用（previewMountedRef 回真）', () => {
  beforeEach(() => {
    state.granted = []
    state.deleteCalls = []
    vi.mocked(previewFile).mockClear()
    // jsdom 未实现 objectURL，补桩防 TypeError
    URL.createObjectURL = vi.fn(() => 'blob:mock-preview-url')
    URL.revokeObjectURL = vi.fn()
  })

  it('StrictMode 下点击预览 → 预览图正常渲染（修复前 ref 停留 false，预览被误判已卸载直接丢弃）', async () => {
    render(
      <StrictMode>
        <FilesContent />
      </StrictMode>,
    )

    const previewBtns = await screen.findAllByRole('button', { name: '预览' })
    fireEvent.click(previewBtns[0] as HTMLElement)

    // 修复前：StrictMode 双挂载 cleanup 把 ref 置 false 且不回真 → 预览 URL 被丢弃，img 永不出现
    await waitFor(() => {
      expect(document.querySelector('img[src="blob:mock-preview-url"]')).toBeTruthy()
    })
  })
})

describe('L6：文件行级并发', () => {
  beforeEach(() => {
    state.granted = [PermissionCodes.FILE_DELETE]
    state.deleteCalls = []
  })

  it('双行删除并发，A 完成不清 B 的 loading', async () => {
    render(
      <ConfigProvider locale={zhCN}>
        <FilesContent />
      </ConfigProvider>,
    )

    const rowA = screen.getByText('a.png').closest('tr') as HTMLElement
    const rowB = screen.getByText('b.png').closest('tr') as HTMLElement
    fireEvent.click(within(rowA).getByRole('button', { name: /禁\s*用/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /确\s*定/ }).at(-1) as HTMLElement)
    fireEvent.click(within(rowB).getByRole('button', { name: /禁\s*用/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /确\s*定/ }).at(-1) as HTMLElement)

    await waitFor(() => {
      expect(within(rowA).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')
      expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')
    })

    await act(async () => {
      state.deleteCalls.find((call) => call.id === 1)?.resolve()
    })

    await waitFor(() => {
      expect(within(rowA).getByRole('button', { name: /禁\s*用/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
    expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).toHaveClass('ant-btn-loading')

    await act(async () => {
      state.deleteCalls.find((call) => call.id === 2)?.resolve()
    })
    await waitFor(() => {
      expect(within(rowB).getByRole('button', { name: /禁\s*用/ })).not.toHaveClass(
        'ant-btn-loading',
      )
    })
  })
})
