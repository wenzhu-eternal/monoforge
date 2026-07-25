import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenPayload } from '@/modules/auth/auth.service'
import { RolesController } from './roles.controller'
import type { RolesService } from './roles.service'

describe('RolesController', () => {
  let controller: RolesController
  let service: RolesService

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
    } as unknown as RolesService

    controller = new RolesController(service)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('findAll', () => {
    const nonAdminUser = { sub: 2, username: 'user', email: 'user@test.com' } as TokenPayload
    const adminUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload

    it('返回分页角色（普通用户）', async () => {
      const mockResult = {
        list: [{ id: 1, name: 'admin' }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }
      vi.mocked(service.findAll).mockResolvedValue(mockResult as never)

      const result = await controller.findAll('1', '10', nonAdminUser)

      expect(result).toEqual(mockResult)
      expect(service.findAll).toHaveBeenCalledWith(1, 10, false)
    })

    it('管理员查询返回所有（含软删）', async () => {
      const mockResult = {
        list: [{ id: 1, name: 'admin' }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }
      vi.mocked(service.findAll).mockResolvedValue(mockResult as never)

      await controller.findAll('1', '10', adminUser)

      expect(service.findAll).toHaveBeenCalledWith(1, 10, true)
    })

    it('未传参时使用默认值', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      } as never)

      await controller.findAll(undefined, undefined, nonAdminUser)

      expect(service.findAll).toHaveBeenCalledWith(1, 10, false)
    })

    it('page 非数字时抛 BadRequestException', async () => {
      const currentUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload
      await expect(controller.findAll('abc', '10', currentUser)).rejects.toThrow(
        BadRequestException,
      )
      expect(service.findAll).not.toHaveBeenCalled()
    })

    it('pageSize 非数字时抛 BadRequestException', async () => {
      const currentUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload
      await expect(controller.findAll('1', 'xyz', currentUser)).rejects.toThrow(BadRequestException)
      expect(service.findAll).not.toHaveBeenCalled()
    })
  })

  describe('findOne', () => {
    it('按 ID 查询角色', async () => {
      const mockRole = { id: 1, name: 'admin' }
      vi.mocked(service.findById).mockResolvedValue(mockRole as never)
      const currentUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload

      const result = await controller.findOne(1, currentUser)

      expect(result).toEqual(mockRole)
      expect(service.findById).toHaveBeenCalledWith(1, true)
    })
  })

  describe('create', () => {
    it('创建角色', async () => {
      const dto = { name: 'editor', description: '编辑员' }
      const mockRole = { id: 2, ...dto }
      vi.mocked(service.create).mockResolvedValue(mockRole as never)

      const result = await controller.create(dto)

      expect(result).toEqual(mockRole)
      expect(service.create).toHaveBeenCalledWith(dto)
    })
  })

  describe('update', () => {
    it('更新角色', async () => {
      const dto = { name: 'new-name' }
      const mockRole = { id: 1, name: 'new-name' }
      vi.mocked(service.update).mockResolvedValue(mockRole as never)

      const result = await controller.update(1, dto)

      expect(result).toEqual(mockRole)
      expect(service.update).toHaveBeenCalledWith(1, dto)
    })
  })

  describe('remove', () => {
    it('删除角色', async () => {
      vi.mocked(service.remove).mockResolvedValue({ message: '角色 ID 1 已删除' })
      const currentUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload

      const result = await controller.remove(1, currentUser)

      expect(result).toEqual({ message: '角色 ID 1 已删除' })
      expect(service.remove).toHaveBeenCalledWith(1)
    })
  })
})
