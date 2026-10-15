import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock hoist 约束：共享可变状态放 vi.hoisted
const state = vi.hoisted(() => ({
  granted: [] as string[],
}))

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
  return {
    useFiles: () => ({
      data: { list: [imageFile], total: 1 },
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
    }),
    useUploadFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRestoreFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
    previewFile: vi.fn().mockResolvedValue('blob:mock-preview-url'),
    downloadFile: vi.fn(),
  }
})

import { previewFile } from '@/hooks/use-files'
import { FilesContent } from './files'

describe('M10：StrictMode 双挂载下预览仍可用（previewMountedRef 回真）', () => {
  beforeEach(() => {
    state.granted = []
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

    const previewBtn = await screen.findByRole('button', { name: '预览' })
    fireEvent.click(previewBtn)

    // 修复前：StrictMode 双挂载 cleanup 把 ref 置 false 且不回真 → 预览 URL 被丢弃，img 永不出现
    await waitFor(() => {
      expect(document.querySelector('img[src="blob:mock-preview-url"]')).toBeTruthy()
    })
  })
})
