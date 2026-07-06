import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { downloadFile, previewFile, useDeleteFile, useFiles, useUploadFile } from './use-files'

describe('use-files hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useFiles', () => {
    it('请求文件列表并返回数据', async () => {
      const mockData = {
        list: [{ id: 1, filename: 'a.png', originalName: 'a.png' }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }
      apiMock.get.mockResolvedValue({ data: { code: 200, data: mockData } })

      const { result } = renderHookWithQuery(() => useFiles({ page: 1, pageSize: 10 }))

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockData)
      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/files', {
        params: { page: 1, pageSize: 10 },
      })
    })
  })

  describe('useUploadFile', () => {
    it('上传文件使用 multipart/form-data', async () => {
      const mockResult = {
        id: 1,
        filename: 'a.png',
        originalName: 'a.png',
        mimeType: 'image/png',
        size: 100,
      }
      apiMock.post.mockResolvedValue({ data: { code: 200, data: mockResult } })

      const { result } = renderHookWithQuery(() => useUploadFile())

      const file = new File(['content'], 'a.png', { type: 'image/png' })
      const res = await result.current.mutateAsync(file)

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/files/upload', expect.any(FormData), {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      expect(res).toEqual(mockResult)
    })
  })

  describe('useDeleteFile', () => {
    it('删除文件', async () => {
      apiMock.delete.mockResolvedValue({ data: { code: 200 } })

      const { result } = renderHookWithQuery(() => useDeleteFile())

      await result.current.mutateAsync(5)

      expect(apiMock.delete).toHaveBeenCalledWith('/api/v1/files/5')
    })
  })

  describe('previewFile', () => {
    it('下载 blob 并返回 object URL', async () => {
      const blob = new Blob(['data'], { type: 'image/png' })
      apiMock.get.mockResolvedValue({ data: blob })

      const url = await previewFile(1)

      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/files/1/preview', { responseType: 'blob' })
      expect(url).toMatch(/^blob:/)
      URL.revokeObjectURL(url)
    })
  })

  describe('downloadFile', () => {
    it('下载 blob 并触发浏览器下载', async () => {
      const blob = new Blob(['data'], { type: 'image/png' })
      apiMock.get.mockResolvedValue({ data: blob })

      // spy 原生 <a> 元素的 click 方法，避免重写 document.createElement 导致递归
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')

      await downloadFile(1, 'test.png')

      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/files/1/download', { responseType: 'blob' })
      expect(clickSpy).toHaveBeenCalled()
      clickSpy.mockRestore()
    })
  })
})
