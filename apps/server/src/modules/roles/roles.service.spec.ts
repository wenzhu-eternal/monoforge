import { ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    query: {
      roles: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
}))

vi.mock('@/db/helpers', () => ({
  // notDeleted 接受单列，返回任意 SQL 片段（测试中不关心具体值）
  notDeleted: vi.fn(() => undefined),
}))

const { db: mockDb } = await import('@/db')

import { RolesService } from './roles.service'

describe('RolesService', () => {
  let service: RolesService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new RolesService()
  })

  describe('findAll', () => {
    it('返回分页角色列表', async () => {
      const mockRoles = [
        { id: 1, name: 'admin', description: '管理员' },
        { id: 2, name: 'user', description: '普通用户' },
      ]
      vi.mocked(mockDb.query.roles.findMany).mockResolvedValue(mockRoles as never)
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 2 }]),
        }),
      } as never)

      const result = await service.findAll(1, 10)

      expect(result.list).toEqual(mockRoles)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
      expect(result.totalPages).toBe(1)
    })

    it('空结果 total=0 时 totalPages 至少为 1', async () => {
      vi.mocked(mockDb.query.roles.findMany).mockResolvedValue([])
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      const result = await service.findAll(1, 10)
      expect(result.totalPages).toBe(1)
    })

    it('pageSize 超过 100 被截断', async () => {
      vi.mocked(mockDb.query.roles.findMany).mockResolvedValue([])
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      const result = await service.findAll(1, 200)
      expect(result.pageSize).toBe(100)
    })
  })

  describe('findById', () => {
    it('返回存在的角色', async () => {
      const mockRole = { id: 1, name: 'admin', description: '管理员' }
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue(mockRole as never)

      const result = await service.findById(1)
      expect(result).toEqual(mockRole)
    })

    it('角色不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue(undefined)

      await expect(service.findById(999)).rejects.toThrow(NotFoundException)
    })
  })

  describe('create', () => {
    it('创建新角色', async () => {
      const mockRole = { id: 1, name: 'editor', description: '编辑' }
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue(undefined)
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockRole]),
        }),
      } as never)

      const result = await service.create({ name: 'editor', description: '编辑' })
      expect(result).toEqual(mockRole)
    })

    it('重名时抛 ConflictException', async () => {
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue({
        id: 1,
        name: 'admin',
      } as never)

      await expect(service.create({ name: 'admin' })).rejects.toThrow(ConflictException)
    })
  })

  describe('update', () => {
    it('更新存在的角色', async () => {
      // 默认 findFirst 返回 undefined（避免影响后续重名检查）
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue(undefined)
      // 第一次调用返回 existing 角色对象
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValueOnce({
        id: 1,
        name: 'admin',
      } as never)
      const updated = { id: 1, name: 'super-admin', description: '超级管理员' }
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      } as never)

      const result = await service.update(1, { name: 'super-admin' })
      expect(result).toEqual(updated)
    })

    it('角色不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue(undefined)

      await expect(service.update(999, { name: 'x' })).rejects.toThrow(NotFoundException)
    })

    it('改成已存在的其他角色名时抛 ConflictException', async () => {
      vi.mocked(mockDb.query.roles.findFirst)
        .mockResolvedValueOnce({ id: 1, name: 'admin' } as never)
        .mockResolvedValueOnce({ id: 2, name: 'editor' } as never)

      await expect(service.update(1, { name: 'editor' })).rejects.toThrow(ConflictException)
    })
  })

  describe('remove', () => {
    it('角色不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue(undefined)

      await expect(service.remove(999)).rejects.toThrow(NotFoundException)
    })

    it('被用户引用时抛 ConflictException', async () => {
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue({
        id: 1,
        name: 'admin',
      } as never)
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 3 }]),
        }),
      } as never)

      await expect(service.remove(1)).rejects.toThrow(ConflictException)
    })

    it('无引用时软删除成功', async () => {
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue({
        id: 2,
        name: 'editor',
      } as never)
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as never)

      const result = await service.remove(2)
      expect(result).toEqual({ message: '角色 ID 2 已删除' })
    })
  })
})
