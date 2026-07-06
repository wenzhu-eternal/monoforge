import { ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
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
  },
}))

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
}))

const { db: mockDb } = await import('@/db')

import { PermissionsService } from './permissions.service'

describe('PermissionsService', () => {
  let service: PermissionsService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new PermissionsService()
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

      const result = await service.create({
        code: 'user:view',
        name: '查看用户',
        routes: ['GET /users/'],
      })

      expect(result).toEqual(mockPermission)
    })

    it('should throw ConflictException for duplicate code', async () => {
      const existingPermission = { id: 1, code: 'user:view', name: '查看用户' }
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(existingPermission as never)

      await expect(service.create({ code: 'user:view', name: '查看用户' })).rejects.toThrow(
        ConflictException,
      )
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

      const result = await service.update(1, { name: '查看用户新名' })

      expect(result).toEqual(mockPermission)
    })

    it('should throw NotFoundException for non-existent id', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue(undefined)

      await expect(service.update(999, { name: 'test' })).rejects.toThrow(NotFoundException)
    })
  })

  describe('remove', () => {
    it('should soft delete permission', async () => {
      vi.mocked(mockDb.query.permissions.findFirst).mockResolvedValue({ id: 1 } as never)
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
})
