import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
  },
}))

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
}))

const { db: mockDb } = await import('@/db')

import { AuditService } from './audit.service'

describe('AuditService', () => {
  let service: AuditService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuditService()
  })

  describe('record', () => {
    it('插入审计日志', async () => {
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      } as never)

      await service.record({
        userId: 1,
        action: 'create',
        resource: 'user',
        resourceId: 2,
        oldValue: { name: 'old' },
        newValue: { name: 'new' },
        ip: '127.0.0.1',
        userAgent: 'vitest',
      })

      const valuesCall = vi.mocked(mockDb.insert).mock.results[0].value.values.mock
        .calls[0][0] as Record<string, unknown>
      expect(valuesCall.userId).toBe(1)
      expect(valuesCall.action).toBe('create')
      expect(valuesCall.resource).toBe('user')
      expect(valuesCall.resourceId).toBe(2)
      expect(valuesCall.ip).toBe('127.0.0.1')
    })
  })

  describe('findAll', () => {
    const mockChain = (items: unknown[]) => ({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(items),
              }),
            }),
          }),
        }),
      }),
    })
    const mockCount = (value: number) => ({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value }]),
        }),
      }),
    })

    it('返回分页审计日志列表', async () => {
      const mockItems = [
        { id: 1, userId: 1, username: 'admin', action: 'create', resource: 'user' },
        { id: 2, userId: 2, username: 'alice', action: 'update', resource: 'role' },
      ]
      vi.mocked(mockDb.select).mockReturnValueOnce(mockChain(mockItems) as never)
      vi.mocked(mockDb.select).mockReturnValueOnce(mockCount(2) as never)

      const result = await service.findAll(1, 10)

      expect(result.list).toEqual(mockItems)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
      expect(result.totalPages).toBe(1)
    })

    it('空结果 totalPages 至少为 1', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce(mockChain([]) as never)
      vi.mocked(mockDb.select).mockReturnValueOnce(mockCount(0) as never)

      const result = await service.findAll(1, 10)
      expect(result.total).toBe(0)
      expect(result.totalPages).toBe(1)
    })

    it('pageSize 超过 100 被截断', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce(mockChain([]) as never)
      vi.mocked(mockDb.select).mockReturnValueOnce(mockCount(0) as never)

      const result = await service.findAll(1, 200)
      expect(result.pageSize).toBe(100)
    })

    it('page 小于 1 时被纠正为 1', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce(mockChain([]) as never)
      vi.mocked(mockDb.select).mockReturnValueOnce(mockCount(0) as never)

      const result = await service.findAll(-1, 10)
      expect(result.page).toBe(1)
    })
  })

  describe('findById', () => {
    it('返回存在的审计日志', async () => {
      const mockLog = {
        id: 1,
        userId: 1,
        username: 'admin',
        action: 'create',
        resource: 'user',
      }
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockLog]),
            }),
          }),
        }),
      } as never)

      const result = await service.findById(1)
      expect(result).toEqual(mockLog)
    })

    it('审计日志不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as never)

      await expect(service.findById(999)).rejects.toThrow(NotFoundException)
    })
  })
})
