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

// M1：Redis mock
const redisServiceMock = {
  eval: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  scanKeys: vi.fn(),
}

vi.mock('@/modules/redis/redis.service', () => ({
  RedisService: vi.fn(() => redisServiceMock),
}))

import { AuditService } from './audit.service'

describe('AuditService', () => {
  let service: AuditService

  beforeEach(() => {
    vi.clearAllMocks()
    redisServiceMock.eval.mockResolvedValue(1) // 默认放行
    service = new AuditService(redisServiceMock as never)
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

    it('M1：匿名登录失败 userId=0 走 IP 键，超限丢弃', async () => {
      vi.mocked(mockDb.insert).mockClear()
      // 第 11 次匿名记录 → 超 10/min 上限
      redisServiceMock.eval.mockResolvedValue(11)

      await service.record({
        userId: 0,
        action: '登录',
        resource: 'AuthController',
        ip: '1.2.3.4',
      })

      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('M1：已认证用户 userId>0 走 user 键，未超限时入库', async () => {
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      } as never)
      redisServiceMock.eval.mockResolvedValue(5) // 5 <= 40，放行

      await service.record({
        userId: 42,
        action: 'update',
        resource: 'UsersController',
        resourceId: 7,
        ip: '10.0.0.1',
      })

      expect(mockDb.insert).toHaveBeenCalled()
      // 验证 key 格式含 userId（eval 第一参数是脚本，第二参数是 keys 数组）
      const callKeys = vi.mocked(redisServiceMock.eval).mock.calls[0][1] as string[]
      expect(callKeys[0]).toContain('audit:record:user:42:')
    })

    it('M1：Redis 故障降级放行（宁多记不漏记）', async () => {
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      } as never)
      redisServiceMock.eval.mockRejectedValue(new Error('Redis down'))

      await service.record({
        userId: 0,
        action: '登录',
        resource: 'AuthController',
        ip: '5.6.7.8',
      })

      // 降级：即使 Redis 故障也入库
      expect(mockDb.insert).toHaveBeenCalled()
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
