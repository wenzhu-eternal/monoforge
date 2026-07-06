import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionsController } from './permissions.controller'
import type { PermissionsService } from './permissions.service'

describe('PermissionsController', () => {
  let controller: PermissionsController
  let service: PermissionsService

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      findAllList: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    } as unknown as PermissionsService

    controller = new PermissionsController(service)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('findAll', () => {
    it('should return paginated permissions', async () => {
      const mockResult = {
        list: [{ id: 1, code: 'user:view', name: '查看用户', routes: ['GET /users/'] }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }

      vi.mocked(service.findAll).mockResolvedValue(mockResult as never)

      const result = await controller.findAll('1', '10')

      expect(result).toEqual(mockResult)
      expect(service.findAll).toHaveBeenCalledWith(1, 10)
    })

    it('should use default values when no params provided', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      } as never)

      await controller.findAll(undefined, undefined)

      expect(service.findAll).toHaveBeenCalledWith(1, 10)
    })
  })

  describe('findAllList', () => {
    it('should return all permissions', async () => {
      const mockPermissions = [
        { id: 1, code: 'user:view', name: '查看用户' },
        { id: 2, code: 'user:create', name: '创建用户' },
      ]

      vi.mocked(service.findAllList).mockResolvedValue(mockPermissions as never)

      const result = await controller.findAllList()

      expect(result).toEqual(mockPermissions)
      expect(service.findAllList).toHaveBeenCalledOnce()
    })
  })

  describe('findOne', () => {
    it('should return permission by id', async () => {
      const mockPermission = { id: 1, code: 'user:view', name: '查看用户' }
      vi.mocked(service.findById).mockResolvedValue(mockPermission as never)

      const result = await controller.findOne(1)

      expect(result).toEqual(mockPermission)
      expect(service.findById).toHaveBeenCalledWith(1)
    })
  })

  describe('create', () => {
    it('should create permission with routes', async () => {
      const mockPermission = {
        id: 1,
        code: 'user:view',
        name: '查看用户',
        routes: ['GET /users/'],
      }
      vi.mocked(service.create).mockResolvedValue(mockPermission as never)

      const result = await controller.create({
        code: 'user:view',
        name: '查看用户',
        routes: ['GET /users/'],
      })

      expect(result).toEqual(mockPermission)
      expect(service.create).toHaveBeenCalledWith({
        code: 'user:view',
        name: '查看用户',
        routes: ['GET /users/'],
      })
    })

    it('should create permission without routes', async () => {
      const mockPermission = { id: 1, code: 'user:view', name: '查看用户' }
      vi.mocked(service.create).mockResolvedValue(mockPermission as never)

      await controller.create({ code: 'user:view', name: '查看用户' })

      expect(service.create).toHaveBeenCalledWith({
        code: 'user:view',
        name: '查看用户',
      })
    })
  })

  describe('update', () => {
    it('should update permission with routes', async () => {
      const mockPermission = {
        id: 1,
        code: 'user:view',
        name: '查看用户新名',
        routes: ['GET /users/', 'POST /users/'],
      }
      vi.mocked(service.update).mockResolvedValue(mockPermission as never)

      const result = await controller.update(1, {
        name: '查看用户新名',
        routes: ['GET /users/', 'POST /users/'],
      })

      expect(result).toEqual(mockPermission)
      expect(service.update).toHaveBeenCalledWith(1, {
        name: '查看用户新名',
        routes: ['GET /users/', 'POST /users/'],
      })
    })
  })

  describe('remove', () => {
    it('should soft delete permission', async () => {
      vi.mocked(service.remove).mockResolvedValue({ message: '权限 ID 1 已删除' })

      const result = await controller.remove(1)

      expect(result).toEqual({ message: '权限 ID 1 已删除' })
      expect(service.remove).toHaveBeenCalledWith(1)
    })
  })
})
