import { BadRequestException, ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    query: {
      roles: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
  isUniqueViolation: vi.fn((error: unknown) => {
    if (typeof error !== 'object' || error === null) return false
    return 'code' in error && (error as { code: string }).code === '23505'
  }),
}))

const { db: mockDb } = await import('@/db')

import { SetupService } from './setup.service'

describe('SetupService', () => {
  let service: SetupService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SetupService()
  })

  describe('getStatus', () => {
    it('无用户时返回未初始化状态', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      const result = await service.getStatus()
      expect(result).toEqual({ initialized: false })
    })

    it('有用户时返回已初始化状态', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 1 }]),
        }),
      } as never)

      const result = await service.getStatus()
      expect(result).toEqual({ initialized: true })
    })

    it('count 结果为空时按 0 处理', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as never)

      const result = await service.getStatus()
      expect(result.initialized).toBe(false)
    })
  })

  describe('initialize', () => {
    it('已初始化时抛 ConflictException', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 1 }]),
        }),
      } as never)

      await expect(
        service.initialize({
          username: 'admin',
          email: 'admin@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow(ConflictException)
      expect(mockDb.transaction).not.toHaveBeenCalled()
    })

    it('未初始化时成功初始化', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      // transaction 回调用 tx：roles 插入返回含 admin 的数组
      vi.mocked(mockDb.transaction).mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: vi.fn().mockResolvedValue([{ pg_try_advisory_lock: true }]),
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ count: 0 }]),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockReturnValue({
                onConflictDoNothing: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([
                    { id: 1, name: 'admin', description: '系统管理员' },
                    { id: 2, name: 'editor', description: '编辑' },
                    { id: 3, name: 'viewer', description: '访客' },
                  ]),
                }),
              }),
            }),
            query: {
              roles: {
                findFirst: vi.fn().mockResolvedValue({ id: 1, name: 'admin' }),
              },
            },
          }
          return cb(tx)
        },
      )

      const result = await service.initialize({
        username: 'admin',
        email: 'admin@example.com',
        password: 'secret123',
        nickname: 'Administrator',
      })

      expect(result).toEqual({ message: '初始化成功', adminUsername: 'admin' })
      expect(mockDb.transaction).toHaveBeenCalledOnce()
    })

    it('唯一约束冲突（code=23505）时抛 ConflictException', async () => {
      // getStatus 返回 initialized: false
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      // transaction 抛出唯一约束冲突
      vi.mocked(mockDb.transaction).mockRejectedValue({ code: '23505', message: 'duplicate' })

      await expect(
        service.initialize({
          username: 'admin',
          email: 'admin@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('其他错误原样抛出', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      const otherError = new Error('db connection lost')
      vi.mocked(mockDb.transaction).mockRejectedValue(otherError)

      await expect(
        service.initialize({
          username: 'admin',
          email: 'admin@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow('db connection lost')
    })

    it('admin 角色创建失败时抛 BadRequestException', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      // 返回的角色列表中无 admin，且 findFirst 也找不到
      vi.mocked(mockDb.transaction).mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: vi.fn().mockResolvedValue([{ pg_try_advisory_lock: true }]),
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ count: 0 }]),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockReturnValue({
                onConflictDoNothing: vi.fn().mockReturnValue({
                  returning: vi
                    .fn()
                    .mockResolvedValue([{ id: 2, name: 'editor', description: '编辑' }]),
                }),
              }),
            }),
            query: {
              roles: {
                findFirst: vi.fn().mockResolvedValue(undefined),
              },
            },
          }
          return cb(tx)
        },
      )

      await expect(
        service.initialize({
          username: 'admin',
          email: 'admin@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
