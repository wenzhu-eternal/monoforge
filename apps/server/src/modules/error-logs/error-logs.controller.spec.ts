import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorLogsController } from './error-logs.controller'
import type { ErrorLogsService } from './error-logs.service'

describe('ErrorLogsController', () => {
  let controller: ErrorLogsController
  let service: ErrorLogsService

  beforeEach(() => {
    service = {
      report: vi.fn(),
      findAll: vi.fn(),
      getStats: vi.fn(),
      findGrouped: vi.fn(),
      findById: vi.fn(),
      resolve: vi.fn(),
      batchResolve: vi.fn(),
      remove: vi.fn(),
      findWhitelist: vi.fn(),
      createWhitelist: vi.fn(),
      updateWhitelist: vi.fn(),
      removeWhitelist: vi.fn(),
    } as unknown as ErrorLogsService

    controller = new ErrorLogsController(service)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('reportError', () => {
    it('上报错误并返回结果', async () => {
      const body = { message: 'Test error', source: 'frontend' }
      vi.mocked(service.report).mockResolvedValue({ id: 1 })

      const result = await controller.reportError(body)

      expect(result).toEqual({ id: 1 })
      expect(service.report).toHaveBeenCalledWith(body)
    })
  })

  describe('findAll', () => {
    it('返回分页错误日志', async () => {
      const mockResult = {
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }
      vi.mocked(service.findAll).mockResolvedValue(mockResult as never)

      const result = await controller.findAll('1', '10', 'keyword', 'backend', 'false')

      expect(result).toEqual(mockResult)
      expect(service.findAll).toHaveBeenCalledWith(1, 10, 'keyword', 'backend', 'false')
    })

    it('未传参时使用默认值', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      } as never)

      await controller.findAll(undefined, undefined, undefined, undefined, undefined)

      expect(service.findAll).toHaveBeenCalledWith(1, 10, undefined, undefined, undefined)
    })

    it('page 非数字时抛 BadRequestException', async () => {
      await expect(controller.findAll('abc', '10')).rejects.toThrow(BadRequestException)
      expect(service.findAll).not.toHaveBeenCalled()
    })

    it('pageSize 非数字时抛 BadRequestException', async () => {
      await expect(controller.findAll('1', 'xyz')).rejects.toThrow(BadRequestException)
      expect(service.findAll).not.toHaveBeenCalled()
    })
  })

  describe('getStats', () => {
    it('返回错误统计', async () => {
      const mockStats = { total: 10, unresolved: 3, bySource: {}, byType: {} }
      vi.mocked(service.getStats).mockResolvedValue(mockStats as never)

      const result = await controller.getStats()

      expect(result).toEqual(mockStats)
      expect(service.getStats).toHaveBeenCalledOnce()
    })
  })

  describe('findGrouped', () => {
    it('返回聚合错误', async () => {
      const mockGroups = [{ message: 'ECONNRESET', source: 'backend', count: 5 }]
      vi.mocked(service.findGrouped).mockResolvedValue(mockGroups as never)

      const result = await controller.findGrouped('5')

      expect(result).toEqual(mockGroups)
      expect(service.findGrouped).toHaveBeenCalledWith(5)
    })

    it('未传 limit 时使用默认值 10', async () => {
      vi.mocked(service.findGrouped).mockResolvedValue([] as never)

      await controller.findGrouped(undefined)

      expect(service.findGrouped).toHaveBeenCalledWith(10)
    })

    it('limit 非数字时抛 BadRequestException', async () => {
      await expect(controller.findGrouped('abc')).rejects.toThrow(BadRequestException)
      expect(service.findGrouped).not.toHaveBeenCalled()
    })

    it('limit 为 0 时抛 BadRequestException', async () => {
      await expect(controller.findGrouped('0')).rejects.toThrow(BadRequestException)
    })
  })

  describe('findWhitelist', () => {
    it('返回白名单列表', async () => {
      const mockList = [{ id: 1, pattern: 'ECONNRESET', matchType: 'message' }]
      vi.mocked(service.findWhitelist).mockResolvedValue(mockList as never)

      const result = await controller.findWhitelist()

      expect(result).toEqual(mockList)
      expect(service.findWhitelist).toHaveBeenCalledOnce()
    })
  })

  describe('findOne', () => {
    it('按 ID 查询错误日志', async () => {
      const mockLog = { id: 1, message: 'error' }
      vi.mocked(service.findById).mockResolvedValue(mockLog as never)

      const result = await controller.findOne(1)

      expect(result).toEqual(mockLog)
      expect(service.findById).toHaveBeenCalledWith(1)
    })
  })

  describe('resolve', () => {
    it('标记错误已处理', async () => {
      vi.mocked(service.resolve).mockResolvedValue({ message: '错误日志 ID 1 已标记为已处理' })

      const result = await controller.resolve(1, { sub: 99 })

      expect(result).toEqual({ message: '错误日志 ID 1 已标记为已处理' })
      expect(service.resolve).toHaveBeenCalledWith(1, 99)
    })
  })

  describe('batchResolve', () => {
    it('批量标记相同报错', async () => {
      const body = { message: 'ECONNRESET', source: 'backend' }
      vi.mocked(service.batchResolve).mockResolvedValue({
        message: '已批量处理 3 条相同错误',
        affected: 3,
      })

      const result = await controller.batchResolve(body, { sub: 99 })

      expect(result.affected).toBe(3)
      expect(service.batchResolve).toHaveBeenCalledWith('ECONNRESET', 'backend', 99)
    })

    it('缺少 message 时抛 BadRequestException', async () => {
      await expect(
        controller.batchResolve({ message: '', source: 'backend' }, { sub: 99 }),
      ).rejects.toThrow(BadRequestException)
      expect(service.batchResolve).not.toHaveBeenCalled()
    })

    it('缺少 source 时抛 BadRequestException', async () => {
      await expect(
        controller.batchResolve({ message: 'err', source: '' }, { sub: 99 }),
      ).rejects.toThrow(BadRequestException)
      expect(service.batchResolve).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('删除错误日志', async () => {
      vi.mocked(service.remove).mockResolvedValue({ message: '错误日志 ID 1 已删除' })

      const result = await controller.remove(1)

      expect(result).toEqual({ message: '错误日志 ID 1 已删除' })
      expect(service.remove).toHaveBeenCalledWith(1)
    })
  })

  describe('createWhitelist', () => {
    it('创建白名单规则', async () => {
      const dto = { pattern: 'ECONNRESET', matchType: 'message' as const }
      const mockCreated = { id: 1, ...dto }
      vi.mocked(service.createWhitelist).mockResolvedValue(mockCreated as never)

      const result = await controller.createWhitelist(dto)

      expect(result).toEqual(mockCreated)
      expect(service.createWhitelist).toHaveBeenCalledWith(dto)
    })
  })

  describe('updateWhitelist', () => {
    it('更新白名单规则', async () => {
      const dto = { pattern: 'new-pattern' }
      const mockUpdated = { id: 1, pattern: 'new-pattern' }
      vi.mocked(service.updateWhitelist).mockResolvedValue(mockUpdated as never)

      const result = await controller.updateWhitelist(1, dto)

      expect(result).toEqual(mockUpdated)
      expect(service.updateWhitelist).toHaveBeenCalledWith(1, dto)
    })
  })

  describe('removeWhitelist', () => {
    it('删除白名单规则', async () => {
      vi.mocked(service.removeWhitelist).mockResolvedValue({ message: '白名单 ID 1 已删除' })

      const result = await controller.removeWhitelist(1)

      expect(result).toEqual({ message: '白名单 ID 1 已删除' })
      expect(service.removeWhitelist).toHaveBeenCalledWith(1)
    })
  })
})
