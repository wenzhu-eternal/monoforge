import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { PermissionCodes } from '@shared/constants/permissions'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenPayload } from '@/modules/auth/auth.service'
import { UsersController } from './users.controller'
import type { UsersService } from './users.service'

describe('UsersController', () => {
  let controller: UsersController
  let service: UsersService

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      getStats: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      hasPermission: vi.fn(),
    } as unknown as UsersService

    controller = new UsersController(service)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('findAll', () => {
    const nonAdminUser = { sub: 2, username: 'user', email: 'user@test.com' } as TokenPayload
    const adminUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload

    it('返回分页用户（普通用户）', async () => {
      const mockResult = {
        list: [{ id: 1, username: 'admin' }],
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
        list: [{ id: 1, username: 'admin' }],
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
      await expect(controller.findAll('abc', '10')).rejects.toThrow(BadRequestException)
      expect(service.findAll).not.toHaveBeenCalled()
    })

    it('pageSize 非数字时抛 BadRequestException', async () => {
      await expect(controller.findAll('1', 'xyz')).rejects.toThrow(BadRequestException)
      expect(service.findAll).not.toHaveBeenCalled()
    })

    it('page 为 0 时抛 BadRequestException', async () => {
      await expect(controller.findAll('0', '10')).rejects.toThrow(BadRequestException)
    })
  })

  describe('getStats', () => {
    it('返回用户统计', async () => {
      const mockStats = { totalUsers: 100, activeUsers: 80 }
      vi.mocked(service.getStats).mockResolvedValue(mockStats as never)

      const result = await controller.getStats()

      expect(result).toEqual(mockStats)
      expect(service.getStats).toHaveBeenCalledOnce()
    })
  })

  describe('findOne', () => {
    it('按 ID 查询用户', async () => {
      const mockUser = { id: 1, username: 'admin' }
      vi.mocked(service.findById).mockResolvedValue(mockUser as never)
      const currentUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload

      const result = await controller.findOne(1, currentUser)

      expect(result).toEqual(mockUser)
      expect(service.findById).toHaveBeenCalledWith(1, true)
    })
  })

  describe('create', () => {
    it('创建用户', async () => {
      const dto = { username: 'newuser', email: 'new@test.com', password: 'Pass1234' }
      const mockUser = { id: 1, ...dto, password: undefined }
      vi.mocked(service.create).mockResolvedValue(mockUser as never)

      const result = await controller.create(dto)

      expect(result).toEqual(mockUser)
      expect(service.create).toHaveBeenCalledWith(dto)
    })
  })

  describe('update', () => {
    const currentUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload

    it('仅改资料（无 roleId/status）不触发 hasPermission', async () => {
      const dto = { nickname: '新昵称' }
      const mockUser = { id: 1, nickname: '新昵称' }
      vi.mocked(service.update).mockResolvedValue(mockUser as never)

      const result = await controller.update(1, dto, currentUser)

      expect(result).toEqual(mockUser)
      expect(service.update).toHaveBeenCalledWith(1, dto)
      expect(service.hasPermission).not.toHaveBeenCalled()
    })

    it('改 roleId 且有 USER_ROLE_MANAGE 权限 → 成功', async () => {
      const dto = { roleId: 2 }
      const mockUser = { id: 1, roleId: 2 }
      vi.mocked(service.hasPermission).mockResolvedValue(true)
      vi.mocked(service.update).mockResolvedValue(mockUser as never)

      const result = await controller.update(1, dto, currentUser)

      expect(result).toEqual(mockUser)
      expect(service.hasPermission).toHaveBeenCalledWith(1, PermissionCodes.USER_ROLE_MANAGE)
      expect(service.update).toHaveBeenCalledWith(1, dto)
    })

    it('改 roleId 但无 USER_ROLE_MANAGE 权限 → 抛 ForbiddenException（防提权）', async () => {
      const dto = { roleId: 2 }
      vi.mocked(service.hasPermission).mockResolvedValue(false)

      await expect(controller.update(1, dto, currentUser)).rejects.toThrow(ForbiddenException)
      expect(service.update).not.toHaveBeenCalled()
    })

    it('改 status 但无 USER_ROLE_MANAGE 权限 → 抛 ForbiddenException（防提权）', async () => {
      const dto = { status: false }
      vi.mocked(service.hasPermission).mockResolvedValue(false)

      await expect(controller.update(1, dto, currentUser)).rejects.toThrow(ForbiddenException)
      expect(service.update).not.toHaveBeenCalled()
    })

    it('改 status 且有 USER_ROLE_MANAGE 权限 → 成功', async () => {
      const dto = { status: false }
      vi.mocked(service.hasPermission).mockResolvedValue(true)
      vi.mocked(service.update).mockResolvedValue({ id: 1, status: false } as never)

      const result = await controller.update(1, dto, currentUser)

      expect(result).toEqual({ id: 1, status: false })
      expect(service.update).toHaveBeenCalledWith(1, dto)
    })
  })

  describe('remove', () => {
    it('删除用户', async () => {
      vi.mocked(service.remove).mockResolvedValue({ message: '用户 ID 1 已删除' })
      const currentUser = { sub: 1, username: 'admin', email: 'admin@test.com' } as TokenPayload

      const result = await controller.remove(1, currentUser)

      expect(result).toEqual({ message: '用户 ID 1 已删除' })
      expect(service.remove).toHaveBeenCalledWith(1)
    })
  })
})
