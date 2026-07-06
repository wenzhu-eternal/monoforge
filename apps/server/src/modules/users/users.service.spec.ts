import { ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock argon2
vi.mock('argon2', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password'),
    verify: vi.fn(),
  },
  hash: vi.fn().mockResolvedValue('hashed-password'),
  verify: vi.fn(),
}))

// Mock CacheService
const cacheServiceMock = {
  delByPattern: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}
vi.mock('@/modules/cache/cache.service', () => ({
  CacheService: vi.fn(() => cacheServiceMock),
}))

vi.mock('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
}))

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
}))

const { db: mockDb } = await import('@/db')

import { UsersService } from './users.service'

describe('UsersService', () => {
  let service: UsersService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new UsersService(cacheServiceMock as never)
  })

  describe('findById', () => {
    it('返回存在的用户（去除密码）', async () => {
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue({
        id: 1,
        username: 'alice',
        email: 'alice@example.com',
        password: 'should-not-leak',
        status: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)

      const result = await service.findById(1)
      expect(result).not.toHaveProperty('password')
      expect(result.username).toBe('alice')
    })

    it('用户不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue(undefined)

      await expect(service.findById(999)).rejects.toThrow(NotFoundException)
    })
  })

  describe('create', () => {
    it('用户名重复时抛 ConflictException', async () => {
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValueOnce({
        id: 1,
        username: 'alice',
      } as never)

      await expect(
        service.create({
          username: 'alice',
          email: 'alice@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('邮箱重复时抛 ConflictException', async () => {
      vi.mocked(mockDb.query.users.findFirst)
        .mockResolvedValueOnce(undefined) // username 不重复
        .mockResolvedValueOnce({ id: 2, email: 'alice@example.com' } as never) // email 重复

      await expect(
        service.create({
          username: 'alice',
          email: 'alice@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('创建成功返回用户（不含密码）', async () => {
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue(undefined)
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: 1,
              username: 'alice',
              email: 'alice@example.com',
              password: 'hashed-password',
              status: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
      } as never)

      const result = await service.create({
        username: 'alice',
        email: 'alice@example.com',
        password: 'secret123',
      })

      expect(result.username).toBe('alice')
      expect(result).not.toHaveProperty('password')
    })
  })

  describe('update', () => {
    it('用户不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue(undefined)

      await expect(service.update(999, { email: 'a@b.com' })).rejects.toThrow(NotFoundException)
    })

    it('邮箱被其他用户占用时抛 ConflictException', async () => {
      vi.mocked(mockDb.query.users.findFirst)
        .mockResolvedValueOnce({ id: 1, email: 'old@b.com' } as never) // existing
        .mockResolvedValueOnce({ id: 2, email: 'new@b.com' } as never) // dup

      await expect(service.update(1, { email: 'new@b.com' })).rejects.toThrow(ConflictException)
    })

    it('成功更新清缓存', async () => {
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue({
        id: 1,
        email: 'a@b.com',
      } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: 1,
                username: 'alice',
                email: 'a@b.com',
                password: 'hashed',
                status: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
          }),
        }),
      } as never)

      await service.update(1, { email: 'a@b.com', roleId: 1 })

      expect(cacheServiceMock.delByPattern).toHaveBeenCalledWith(expect.stringContaining('1'))
    })
  })

  describe('remove', () => {
    it('用户不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue(undefined)

      await expect(service.remove(999)).rejects.toThrow(NotFoundException)
    })

    it('软删除成功并清缓存', async () => {
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue({ id: 1 } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as never)

      const result = await service.remove(1)
      expect(result.message).toContain('1')
      expect(cacheServiceMock.delByPattern).toHaveBeenCalled()
    })
  })

  describe('getStats', () => {
    it('返回总用户数和活跃用户数', async () => {
      vi.mocked(mockDb.select)
        .mockReturnValueOnce({
          from: vi.fn().mockResolvedValue([{ count: 100 }]),
        } as never)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 80 }]),
          }),
        } as never)

      const result = await service.getStats()
      expect(result.totalUsers).toBe(100)
      expect(result.activeUsers).toBe(80)
    })
  })
})
