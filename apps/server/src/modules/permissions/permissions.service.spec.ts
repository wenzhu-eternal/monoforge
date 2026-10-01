import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => {
  const tx = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }
  return {
    db: {
      query: {
        permissions: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn(),
      update: vi.fn(),
      select: vi.fn(),
      // L18：remove 走事务（软删 + 清绑定原子化），mock 直接透传 tx
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  }
})

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
  maybeDeleted: vi.fn(() => undefined),
  isUniqueViolation: vi.fn(() => false),
}))

const { db: mockDb } = await import('@/db')

import { PermissionsService } from './permissions.service'

describe('PermissionsService', () => {
  let service: PermissionsService
  const mockRedisService = {
    deleteByPattern: vi.fn().mockResolvedValue(0),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisService.deleteByPattern.mockResolvedValue(0)
    service = new PermissionsService(mockRedisService as never)
  })

  describe('findAll', () => {
    it('should return paginated permissions', async () => {
      const mockPermissions = [
        { id: 1, code: 'user:view', name: '查看用户', routes: ['GET /users/'] },
        { id: 2, code: 'user:create', name: '创建用户', routes: ['POST /users/'] },
      ]

      vi.mocked(mockDb.query.permissions.findMany).mockResolvedValue(mockPermissions as never)
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 2 }]),
        }),
      } as never)

      const result = await service.findAll(1, 10)

      expect(result.list).toEqual(mockPermissions)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
      expect(result.totalPages).toBe(1)
    })

    it('should handle empty results', async () => {
      vi.mocked(mockDb.query.permissions.findMany).mockResolvedValue([])
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never)

      const result = await service.findAll(1, 10)

      expect(result.list).toEqual([])
      expect(result.total).toBe(0)
      expect(result.totalPages).toBe(1)
    })
  })

  describe('findAllList', () => {
    it('should return all permissions without pagination', async () => {
      const mockPermissions = [
        { id: 1, code: 'user:view', name: '查看用户' },
        { id: 2, code: 'user:create', name: '创建用户' },
      ]

      vi.mocked(mockDb.query.permissions.findMany).mockResolvedValue(mockPermissions as never)

      const result = await service.findAllList()

      expect(result).toEqual(mockPermissions)
    })
  })

  describe('findById', () => {
    it('should return permission by id', async () => {
      const mockPermission = { id: 1, code: 'user:view', name: '查看用户' }
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(mockPermission as never)

      const result = await service.findById(1)

      expect(result).toEqual(mockPermission)
    })

    it('should throw NotFoundException for non-existent id', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(undefined)

      await expect(service.findById(999)).rejects.toThrow(NotFoundException)
    })
  })

  describe('create', () => {
    it('should create a new permission', async () => {
      const mockPermission = { id: 1, code: 'user:view', name: '查看用户', routes: ['GET /users/'] }
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(undefined)
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockPermission]),
        }),
      } as never)

      const result = await service.create(
        {
          code: 'user:view',
          name: '查看用户',
          routes: ['GET /users/'],
        },
        { isAdmin: true },
      )

      expect(result).toEqual(mockPermission)
    })

    it('should throw ConflictException for duplicate code', async () => {
      const existingPermission = { id: 1, code: 'user:view', name: '查看用户' }
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(existingPermission as never)

      await expect(
        service.create({ code: 'user:view', name: '查看用户' }, { isAdmin: true }),
      ).rejects.toThrow(ConflictException)
    })

    it('M1: 非超管创建携带 routes 时应抛 ForbiddenException', async () => {
      await expect(
        service.create(
          { code: 'user:view', name: '查看用户', routes: ['DELETE /users/:id'] },
          { isAdmin: false },
        ),
      ).rejects.toThrow(ForbiddenException)
    })

    it('M1: 非超管创建不带 routes 时放行（仅 routes 受限）', async () => {
      const mockPermission = { id: 1, code: 'user:view', name: '查看用户' }
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(undefined)
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockPermission]),
        }),
      } as never)

      const result = await service.create(
        { code: 'user:view', name: '查看用户' },
        { isAdmin: false },
      )

      expect(result).toEqual(mockPermission)
    })
  })

  describe('update', () => {
    it('should update permission', async () => {
      const mockPermission = { id: 1, code: 'user:view', name: '查看用户新名' }
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue({
        id: 1,
        code: 'user:view',
      } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockPermission]),
          }),
        }),
      } as never)

      const result = await service.update(1, { name: '查看用户新名' }, { isAdmin: true })

      expect(result).toEqual(mockPermission)
    })

    it('should throw NotFoundException for non-existent id', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(undefined)

      await expect(service.update(999, { name: 'test' }, { isAdmin: true })).rejects.toThrow(
        NotFoundException,
      )
    })

    it('M1: 非超管更新携带 routes 时应抛 ForbiddenException', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue({
        id: 1,
        code: 'user:view',
      } as never)

      await expect(
        service.update(1, { routes: ['DELETE /users/:id'] }, { isAdmin: false }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('M1: 非超管更新不带 routes 时放行', async () => {
      const mockPermission = { id: 1, code: 'user:view', name: '查看用户新名' }
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue({
        id: 1,
        code: 'user:view',
      } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockPermission]),
          }),
        }),
      } as never)

      const result = await service.update(1, { name: '查看用户新名' }, { isAdmin: false })

      expect(result).toEqual(mockPermission)
    })
  })

  describe('remove', () => {
    it('should soft delete permission', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue({ id: 1 } as never)
      // 绑定校验 join 未删角色：无引用时放行
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        }),
      } as never)
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as never)

      const result = await service.remove(1)

      expect(result).toEqual({ message: '权限 ID 1 已删除' })
    })

    it('should throw NotFoundException for non-existent id', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(undefined)

      await expect(service.remove(999)).rejects.toThrow(NotFoundException)
    })
  })

  describe('restore', () => {
    it('should throw NotFoundException for non-existent id', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(undefined)

      await expect(service.restore(999)).rejects.toThrow(NotFoundException)
    })

    it('should throw ConflictException when not soft-deleted', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue({
        id: 1,
        code: 'user:view',
        deletedAt: null,
      } as never)

      await expect(service.restore(1)).rejects.toThrow(ConflictException)
    })

    it('should restore successfully', async () => {
      vi.mocked(mockDb.query.permissions.findFirst)
        .mockResolvedValueOnce({ id: 1, code: 'user:view', deletedAt: new Date() } as never)
        .mockResolvedValueOnce(undefined) // duplicate check
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, code: 'user:view', deletedAt: null }]),
          }),
        }),
      } as never)

      const result = await service.restore(1)
      expect(result).toEqual({ id: 1, code: 'user:view', deletedAt: null })
    })
  })
})
