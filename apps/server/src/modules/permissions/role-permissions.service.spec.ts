import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    query: {
      roles: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
}))

const { db: mockDb } = await import('@/db')

import { RolePermissionsService } from './role-permissions.service'

describe('RolePermissionsService', () => {
  let service: RolePermissionsService
  const mockRedisService = {
    del: vi.fn().mockResolvedValue(1),
  }
  const adminCaller = { userId: 1, roleId: 1, isAdmin: true }
  const editorCaller = { userId: 2, roleId: 2, isAdmin: false }
  const mockTx = {
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  }

  const mockRoleExists = () => {
    vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue({ id: 2, name: 'editor' } as never)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisService.del.mockResolvedValue(1)
    mockTx.delete.mockClear()
    mockTx.insert.mockClear()
    service = new RolePermissionsService(mockRedisService as never)
    vi.mocked(mockDb.transaction).mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(mockTx),
    )
  })

  describe('updateRolePermissions', () => {
    it('should throw NotFoundException for non-existent role', async () => {
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue(undefined)

      await expect(service.updateRolePermissions(999, [], adminCaller)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('非超管禁止修改自己所属角色的权限（防自提权）', async () => {
      mockRoleExists()

      await expect(service.updateRolePermissions(2, ['user:view'], editorCaller)).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('M2: 传入码全部无效时应拒绝而非清空角色权限', async () => {
      mockRoleExists()
      // 有效码查询返回空 → validCodes=[]，旧实现会"删光旧权限、不插新权限"
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as never)

      await expect(
        service.updateRolePermissions(2, ['ghost:perm', 'another:ghost'], adminCaller),
      ).rejects.toThrow(BadRequestException)
      // 未进事务，权限未被清空
      expect(mockDb.transaction).not.toHaveBeenCalled()
    })

    it('M2: 超管明确传空数组清空仍允许（有审计留痕）', async () => {
      mockRoleExists()

      const result = await service.updateRolePermissions(2, [], adminCaller)

      expect(result.message).toContain('editor')
      expect(mockDb.transaction).toHaveBeenCalled()
    })

    it('J2: 非超管传空数组清空被拒绝', async () => {
      mockRoleExists()

      await expect(service.updateRolePermissions(3, [], editorCaller)).rejects.toThrow(
        ForbiddenException,
      )
      expect(mockDb.transaction).not.toHaveBeenCalled()
    })

    it('非超管不能授予自身未持有的权限（防越权授予）', async () => {
      mockRoleExists()
      mockRoleExists()
      // 第一次 select: 有效码过滤（返回请求码有效）；第二次 select: 调用者持有码（返回较少）
      vi.mocked(mockDb.select)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ code: 'user:view' }, { code: 'user:create' }]),
          }),
        } as never)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ permission: 'user:view' }]),
            }),
          }),
        } as never)

      await expect(
        service.updateRolePermissions(3, ['user:view', 'user:create'], editorCaller),
      ).rejects.toThrow(ForbiddenException)
    })

    it('M12: 缓存失效失败只告警不拖垮请求', async () => {
      mockRoleExists()
      mockRedisService.del.mockRejectedValue(new Error('redis down'))

      await expect(service.updateRolePermissions(2, [], adminCaller)).resolves.toEqual({
        message: expect.stringContaining('editor'),
        skipped: [],
      })
    })

    it('正常更新: 删旧插新并失效缓存', async () => {
      mockRoleExists()
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ code: 'user:view' }]),
        }),
      } as never)

      const result = await service.updateRolePermissions(
        2,
        ['user:view', 'ghost:perm'],
        adminCaller,
      )

      expect(result.skipped).toEqual(['ghost:perm'])
      expect(mockTx.delete).toHaveBeenCalled()
      expect(mockTx.insert).toHaveBeenCalled()
      expect(mockRedisService.del).toHaveBeenCalledWith('perm:role:2')
    })
  })
})
