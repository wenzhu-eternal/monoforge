import { ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock RedisService
const redisServiceMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(true),
}

vi.mock('@/modules/redis/redis.service', () => ({
  RedisService: vi.fn(() => redisServiceMock),
}))

vi.mock('@/db', () => ({
  db: {
    query: {
      errorLogs: {
        findFirst: vi.fn(),
      },
      errorWhitelist: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  errorLogs: {
    id: 'id',
    message: 'message',
    source: 'source',
    errorType: 'errorType',
    isResolved: 'isResolved',
    createdAt: 'createdAt',
    deletedAt: 'deletedAt',
  },
}))

vi.mock('@/db/schema/error-whitelist', () => ({
  errorWhitelist: {
    id: 'id',
    pattern: 'pattern',
    matchType: 'matchType',
    isActive: 'isActive',
    createdAt: 'createdAt',
    deletedAt: 'deletedAt',
  },
}))

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
  maybeDeleted: vi.fn(() => undefined),
  isUniqueViolation: vi.fn(() => false),
}))

const { db: mockDb } = await import('@/db')

import { ErrorLogsService } from './error-logs.service'

describe('ErrorLogsService', () => {
  let service: ErrorLogsService

  beforeEach(() => {
    vi.clearAllMocks()
    // RedisService 默认返回 null（缓存未命中）
    redisServiceMock.get.mockResolvedValue(null)
    service = new ErrorLogsService(redisServiceMock as never)
  })

  describe('report - 白名单过滤', () => {
    it('白名单命中时返回 skipped 不入库', async () => {
      // 模拟白名单缓存命中
      redisServiceMock.get.mockResolvedValue(
        JSON.stringify([{ pattern: 'ECONNRESET', matchType: 'message', isActive: true }]),
      )

      const result = await service.report({ message: 'ECONNRESET timeout' })

      expect(result).toEqual({ skipped: true, reason: 'whitelisted' })
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('白名单未命中时入库', async () => {
      redisServiceMock.get.mockResolvedValue(null)
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as never)
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      } as never)

      const result = await service.report({ message: 'unexpected error' })

      expect(result).toEqual({ id: 1 })
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('缓存中 isActive=false 的规则不匹配（停用规则不生效）', async () => {
      redisServiceMock.get.mockResolvedValue(
        JSON.stringify([{ pattern: 'ECONNRESET', matchType: 'message', isActive: false }]),
      )

      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      } as never)

      const result = await service.report({ message: 'ECONNRESET timeout' })

      expect(result).toEqual({ id: 1 })
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  describe('record', () => {
    it('调用 report 入库，自动补 source/errorType', async () => {
      redisServiceMock.get.mockResolvedValue(null)
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as never)
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 5 }]),
        }),
      } as never)

      await service.record({
        message: 'Internal Server Error',
        stack: 'Error: ...',
        userId: 1,
      })

      // 验证 insert 被调用，且 values 包含 source: backend / errorType: http_error
      const valuesCall = vi.mocked(mockDb.insert).mock.results[0].value.values.mock
        .calls[0][0] as Record<string, unknown>
      expect(valuesCall.source).toBe('backend')
      expect(valuesCall.errorType).toBe('http_error')
    })
  })

  describe('resolve', () => {
    it('标记已处理', async () => {
      vi.mocked(mockDb.query.errorLogs.findFirst).mockResolvedValue({ id: 1 } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as never)

      const result = await service.resolve(1, 99)
      expect(result.message).toContain('1')
    })

    it('日志不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.errorLogs.findFirst).mockResolvedValue(undefined)

      await expect(service.resolve(999, 1)).rejects.toThrow(NotFoundException)
    })
  })

  describe('batchResolve', () => {
    it('按 message+source 批量更新', async () => {
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]),
          }),
        }),
      } as never)

      const result = await service.batchResolve('ECONNRESET', 'backend', 99)
      expect(result.affected).toBe(3)
      expect(result.message).toContain('3')
    })
  })

  describe('remove', () => {
    it('软删除存在的日志', async () => {
      vi.mocked(mockDb.query.errorLogs.findFirst).mockResolvedValue({ id: 1 } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as never)

      const result = await service.remove(1)
      expect(result.message).toContain('1')
    })

    it('日志不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.errorLogs.findFirst).mockResolvedValue(undefined)

      await expect(service.remove(999)).rejects.toThrow(NotFoundException)
    })
  })

  describe('findWhitelist（白名单缓存）', () => {
    it('白名单缓存命中时复用缓存，不查库', async () => {
      const cachedList = [{ pattern: 'ECONNRESET', matchType: 'message' }]
      redisServiceMock.get.mockResolvedValue(JSON.stringify(cachedList))

      const result = await service.findWhitelist()

      expect(result).toEqual(cachedList)
      expect(mockDb.select).not.toHaveBeenCalled()
      expect(redisServiceMock.set).not.toHaveBeenCalled()
    })

    it('白名单缓存未命中时查库并写入缓存', async () => {
      redisServiceMock.get.mockResolvedValue(null)
      const dbList = [{ pattern: 'x', matchType: 'message' }]
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(dbList),
          }),
        }),
      } as never)

      const result = await service.findWhitelist()

      expect(result).toEqual(dbList)
      expect(redisServiceMock.set).toHaveBeenCalledWith(
        'error:whitelist:all:notDeleted',
        JSON.stringify(dbList),
        60,
      )
    })

    it('includeDeleted=true 时直查 DB 不读写缓存（管理员可见已删规则）', async () => {
      redisServiceMock.get.mockResolvedValue(null)
      const dbList = [
        { pattern: 'active-rule', matchType: 'message', deletedAt: null },
        { pattern: 'deleted-rule', matchType: 'message', deletedAt: new Date() },
      ]
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(dbList),
        }),
      } as never)

      const result = await service.findWhitelist(true)

      expect(result).toEqual(dbList)
      expect(redisServiceMock.get).not.toHaveBeenCalled()
      expect(redisServiceMock.set).not.toHaveBeenCalled()
    })

    it('includeDeleted=false 时走缓存路径（普通用户）', async () => {
      redisServiceMock.get.mockResolvedValue(null)
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as never)

      await service.findWhitelist(false)

      expect(redisServiceMock.get).toHaveBeenCalledWith('error:whitelist:all:notDeleted')
    })
  })

  describe('createWhitelist', () => {
    it('创建白名单并失效缓存', async () => {
      const created = { id: 1, pattern: 'ECONNRESET', matchType: 'message' }
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      } as never)

      const result = await service.createWhitelist({ pattern: 'ECONNRESET' })

      expect(result).toEqual(created)
      expect(redisServiceMock.del).toHaveBeenCalledWith('error:whitelist:all:notDeleted')
    })
  })

  describe('updateWhitelist', () => {
    it('更新存在的白名单', async () => {
      vi.mocked(mockDb.query.errorWhitelist.findFirst).mockResolvedValue({ id: 1 } as never)
      const updated = { id: 1, pattern: 'new-pattern' }
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      } as never)

      const result = await service.updateWhitelist(1, { pattern: 'new-pattern' })

      expect(result).toEqual(updated)
      expect(redisServiceMock.del).toHaveBeenCalledWith('error:whitelist:all:notDeleted')
    })

    it('白名单不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.errorWhitelist.findFirst).mockResolvedValue(undefined)

      await expect(service.updateWhitelist(999, { pattern: 'x' })).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('removeWhitelist', () => {
    it('软删除存在的白名单并失效缓存', async () => {
      vi.mocked(mockDb.query.errorWhitelist.findFirst).mockResolvedValue({ id: 1 } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as never)

      const result = await service.removeWhitelist(1)
      expect(result.message).toContain('1')
      expect(redisServiceMock.del).toHaveBeenCalledWith('error:whitelist:all:notDeleted')
    })

    it('白名单不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.errorWhitelist.findFirst).mockResolvedValue(undefined)

      await expect(service.removeWhitelist(999)).rejects.toThrow(NotFoundException)
    })
  })

  describe('restoreWhitelist', () => {
    it('白名单不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.errorWhitelist.findFirst).mockResolvedValue(undefined)

      await expect(service.restoreWhitelist(999)).rejects.toThrow(NotFoundException)
    })

    it('白名单未被删除时抛 ConflictException', async () => {
      vi.mocked(mockDb.query.errorWhitelist.findFirst).mockResolvedValue({
        id: 1,
        deletedAt: null,
      } as never)

      await expect(service.restoreWhitelist(1)).rejects.toThrow(ConflictException)
    })

    it('恢复成功', async () => {
      vi.mocked(mockDb.query.errorWhitelist.findFirst).mockResolvedValue({
        id: 1,
        deletedAt: new Date(),
      } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, pattern: 'test', deletedAt: null }]),
          }),
        }),
      } as never)

      const result = await service.restoreWhitelist(1)
      expect(result).toEqual({ id: 1, pattern: 'test', deletedAt: null })
      expect(redisServiceMock.del).toHaveBeenCalledWith('error:whitelist:all:notDeleted')
    })
  })
})
