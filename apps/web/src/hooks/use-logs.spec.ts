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
import {
  useBatchResolveErrorLog,
  useCreateWhitelist,
  useDeleteErrorLog,
  useDeleteWhitelist,
  useErrorLogs,
  useErrorLogsGrouped,
  useErrorStats,
  useResolveErrorLog,
  useUpdateWhitelist,
  useWhitelist,
} from './use-logs'

describe('use-logs hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useErrorLogs', () => {
    it('请求错误日志列表', async () => {
      const mockData = {
        list: [{ id: 1, message: 'err', source: 'backend' }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }
      apiMock.get.mockResolvedValue({ data: { code: 200, data: mockData } })

      const { result } = renderHookWithQuery(() =>
        useErrorLogs({ page: 1, pageSize: 10, source: 'backend', isResolved: 'false' }),
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockData)
      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/error-logs', {
        params: { page: 1, pageSize: 10, source: 'backend', isResolved: 'false' },
      })
    })
  })

  describe('useErrorStats', () => {
    it('请求错误统计', async () => {
      const mockStats = { total: 10, unresolved: 3, bySource: {}, byType: {} }
      apiMock.get.mockResolvedValue({ data: { code: 200, data: mockStats } })

      const { result } = renderHookWithQuery(() => useErrorStats())

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockStats)
      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/error-logs/stats')
    })
  })

  describe('useErrorLogsGrouped', () => {
    it('使用默认 limit=10', async () => {
      apiMock.get.mockResolvedValue({ data: { code: 200, data: [] } })

      const { result } = renderHookWithQuery(() => useErrorLogsGrouped())

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/error-logs/grouped', {
        params: { limit: 10 },
      })
    })

    it('指定 limit', async () => {
      apiMock.get.mockResolvedValue({ data: { code: 200, data: [] } })

      const { result } = renderHookWithQuery(() => useErrorLogsGrouped(5))

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/error-logs/grouped', {
        params: { limit: 5 },
      })
    })
  })

  describe('useResolveErrorLog', () => {
    it('标记单条错误已处理', async () => {
      apiMock.post.mockResolvedValue({ data: { code: 200 } })

      const { result } = renderHookWithQuery(() => useResolveErrorLog())

      await result.current.mutateAsync(1)

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/error-logs/1/resolve')
    })
  })

  describe('useBatchResolveErrorLog', () => {
    it('批量标记相同报错已处理', async () => {
      apiMock.post.mockResolvedValue({
        data: { code: 200, data: { message: '已批量处理 3 条相同错误', affected: 3 } },
      })

      const { result } = renderHookWithQuery(() => useBatchResolveErrorLog())

      const res = await result.current.mutateAsync({ message: 'ECONNRESET', source: 'backend' })

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/error-logs/batch-resolve', {
        message: 'ECONNRESET',
        source: 'backend',
      })
      expect(res.affected).toBe(3)
    })
  })

  describe('useDeleteErrorLog', () => {
    it('删除错误日志', async () => {
      apiMock.delete.mockResolvedValue({ data: { code: 200 } })

      const { result } = renderHookWithQuery(() => useDeleteErrorLog())

      await result.current.mutateAsync(1)

      expect(apiMock.delete).toHaveBeenCalledWith('/api/v1/error-logs/1')
    })
  })

  describe('useWhitelist', () => {
    it('请求白名单列表', async () => {
      const mockList = [{ id: 1, pattern: 'ECONNRESET', matchType: 'message' }]
      apiMock.get.mockResolvedValue({ data: { code: 200, data: mockList } })

      const { result } = renderHookWithQuery(() => useWhitelist())

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockList)
      expect(apiMock.get).toHaveBeenCalledWith('/api/v1/error-logs/whitelist')
    })
  })

  describe('useCreateWhitelist', () => {
    it('创建白名单规则', async () => {
      apiMock.post.mockResolvedValue({ data: { code: 200, data: { id: 1 } } })

      const { result } = renderHookWithQuery(() => useCreateWhitelist())

      await result.current.mutateAsync({
        pattern: 'ECONNRESET',
        matchType: 'message',
        isActive: true,
      })

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/error-logs/whitelist', {
        pattern: 'ECONNRESET',
        matchType: 'message',
        isActive: true,
      })
    })
  })

  describe('useUpdateWhitelist', () => {
    it('更新白名单规则', async () => {
      apiMock.patch.mockResolvedValue({ data: { code: 200, data: { id: 1 } } })

      const { result } = renderHookWithQuery(() => useUpdateWhitelist())

      await result.current.mutateAsync({ id: 1, data: { pattern: 'new' } })

      expect(apiMock.patch).toHaveBeenCalledWith('/api/v1/error-logs/whitelist/1', {
        pattern: 'new',
      })
    })
  })

  describe('useDeleteWhitelist', () => {
    it('删除白名单规则', async () => {
      apiMock.delete.mockResolvedValue({ data: { code: 200 } })

      const { result } = renderHookWithQuery(() => useDeleteWhitelist())

      await result.current.mutateAsync(1)

      expect(apiMock.delete).toHaveBeenCalledWith('/api/v1/error-logs/whitelist/1')
    })
  })
})
