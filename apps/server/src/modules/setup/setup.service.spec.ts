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

// L34 同款：getEnv().ADMIN_ROLE_ID mock 固定为 1，单测不随 .env 漂移
vi.mock('@/config/env', () => ({
  getEnv: () => ({ ADMIN_ROLE_ID: 1, DEFAULT_USER_ROLE_ID: 2 }),
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
                    { id: 2, name: 'user', description: '普通用户' },
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

    it('初始化同时创建 user 角色并仅授 mail:send（与 seed 对齐，公开注册可用）', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { id: 1, name: 'admin', description: '系统管理员' },
              { id: 2, name: 'user', description: '普通用户' },
            ]),
          }),
        }),
      })
      vi.mocked(mockDb.transaction).mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: vi.fn().mockResolvedValue([{ pg_try_advisory_lock: true }]),
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ count: 0 }]),
              }),
            }),
            insert: insertMock,
            query: {
              roles: {
                findFirst: vi.fn().mockResolvedValue({ id: 1, name: 'admin' }),
              },
            },
          }
          return cb(tx)
        },
      )

      await service.initialize({
        username: 'admin',
        email: 'admin@example.com',
        password: 'secret123',
      })

      // M11 后：roles + permissions + admin 绑定 + users 建户 = 4 次 insert
      // （M3：user 角色默认零权限，不再有第 5 次 user 绑定 insert）
      expect(insertMock).toHaveBeenCalledTimes(4)
      // 共享 mock：values 的调用序列 = 4 次 insert 的入参，逐一核对灌入内容
      const valuesArg = insertMock.mock.results[0].value.values.mock.calls.map((c) => c[0])
      expect(valuesArg[0]).toHaveLength(2) // DEFAULT_ROLES: admin + user
      expect(valuesArg[1]).toHaveLength(22) // DEFAULT_PERMISSIONS 全量灌入
      expect(valuesArg[2]).toHaveLength(22) // admin 角色全量绑定
      expect(valuesArg[3]).toMatchObject({ username: 'admin' }) // 管理员建户
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
                    .mockResolvedValue([{ id: 2, name: 'user', description: '普通用户' }]),
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

    it('L2: 全量软删后重初始化复活原行，建户复用原 admin id', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
      const updateMock = vi.fn().mockReturnValue({ set: updateSet })
      // 调用序列：活跃 admin → 软删 admin → 活跃 user → 软删 user → 之后兜底
      const findFirst = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 1, name: 'admin' })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 2, name: 'user' })
        .mockResolvedValueOnce({ id: 1, name: 'admin' })
        .mockResolvedValueOnce({ id: 2, name: 'user' })
      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            // 复活后部分唯一索引拦下插入，无新行返回
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      vi.mocked(mockDb.transaction).mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: vi.fn().mockResolvedValue([{ pg_try_advisory_lock: true }]),
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ count: 0 }]),
              }),
            }),
            insert: insertMock,
            update: updateMock,
            query: { roles: { findFirst } },
          }
          return cb(tx)
        },
      )

      await service.initialize({
        username: 'admin',
        email: 'admin@example.com',
        password: 'secret123',
      })

      // admin/user 两个软删角色均复活（set deletedAt=null）
      expect(updateSet).toHaveBeenCalledTimes(2)
      expect(updateSet).toHaveBeenCalledWith({ deletedAt: null })
      // 建户绑定的是复活的原 admin id=1，而非 serial 续号的新角色
      // （values 为共享 mock，calls 序列 = 4 次 insert 入参，第 4 次是建户）
      const allValues = insertMock.mock.results[0].value.values.mock.calls.map((c) => c[0])
      expect(allValues[3]).toMatchObject({ username: 'admin', roleId: 1 })
    })

    it('L2: 解析出的 admin id 与 ADMIN_ROLE_ID 不一致时显式失败', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

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
                    .mockResolvedValue([{ id: 9, name: 'admin', description: '漂移的 admin' }]),
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

      await expect(
        service.initialize({
          username: 'admin',
          email: 'admin@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow('与 ADMIN_ROLE_ID 1 不一致')
    })
  })
})
