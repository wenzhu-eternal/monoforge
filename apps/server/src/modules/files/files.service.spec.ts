import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock db（files.service 直接 import，需提供 query.files.findFirst + update + select/delete）
const mockFindFirst = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/db', () => ({
  db: {
    query: {
      files: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

// Mock helpers（notDeleted 在 service 内组合 where，mock 成透传函数即可）
vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(),
  maybeDeleted: vi.fn(),
}))

// Mock file-validator: isPathSafe 透传（测试路径不匹配实际 cwd，统一放行）
vi.mock('@/common/file-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/file-validator')>()
  return {
    ...actual,
    isPathSafe: vi.fn().mockReturnValue(true),
  }
})

// Mock fs/promises（capture mkdir + rename 调用）
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockRename = vi.fn().mockResolvedValue(undefined)
const mockUnlink = vi.fn().mockResolvedValue(undefined)
vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}))

const { FilesService } = await import('./files.service')

describe('FilesService', () => {
  let service: InstanceType<typeof FilesService>
  let mockRedisQuota: {
    incr: ReturnType<typeof vi.fn>
    expire: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockRename.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
    mockRedisQuota = {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(true),
    }
    service = new FilesService(mockRedisQuota as never)
  })

  describe('remove', () => {
    it('文件不存在 → 抛 NotFoundException', async () => {
      mockFindFirst.mockResolvedValue(undefined)

      await expect(service.remove(999, 1, false)).rejects.toThrow(NotFoundException)
      expect(mockRename).not.toHaveBeenCalled()
    })

    it('非上传者非 admin → 抛 ForbiddenException', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        path: '/uploads/a.png',
        filename: 'a.png',
        uploadedBy: 2,
      })

      await expect(service.remove(1, 3, false)).rejects.toThrow(ForbiddenException)
      expect(mockRename).not.toHaveBeenCalled()
    })

    it('admin 删除他人文件 → 成功并移磁盘到隔离目录', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        path: '/uploads/a.png',
        filename: 'a.png',
        uploadedBy: 2,
      })
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      } as never)

      const result = await service.remove(1, 3, true)

      expect(result.message).toContain('1')
      // 磁盘文件 rename 到 uploads-trash/，前缀为时间戳
      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('uploads-trash'), {
        recursive: true,
      })
      expect(mockRename).toHaveBeenCalledWith('/uploads/a.png', expect.stringContaining('a.png'))
      const trashPath = mockRename.mock.calls[0]?.[1] as string
      expect(trashPath).toMatch(/uploads-trash\/\d+-a\.png$/)
      // 软删 DB 记录
      expect(mockUpdate).toHaveBeenCalled()
    })

    it('M6: filename 撑满 255 时 trashPath 不超过 varchar(255) 列宽', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        path: '/uploads/a.png',
        filename: 'a'.repeat(255),
        uploadedBy: 3,
      })
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      } as never)

      await service.remove(1, 3, true)

      const trashPath = mockRename.mock.calls[0]?.[1] as string
      expect(trashPath).toMatch(/uploads-trash\//)
      expect(trashPath.length).toBeLessThanOrEqual(255)
      // 时间戳前缀保留（截断只砍尾部，唯一性不受影响）
      expect(trashPath).toMatch(/uploads-trash\/\d+/)
    })

    it('上传者本人删除 → 成功', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        path: '/uploads/b.png',
        filename: 'b.png',
        uploadedBy: 5,
      })
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      } as never)

      const result = await service.remove(1, 5, false)

      expect(result.message).toContain('1')
      expect(mockRename).toHaveBeenCalled()
    })

    it('磁盘 rename 失败 → 仅告警不阻断软删', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        path: '/uploads/missing.png',
        filename: 'missing.png',
        uploadedBy: 5,
      })
      mockRename.mockRejectedValue(new Error('ENOENT'))
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      } as never)

      // 不应抛错，DB 软删仍执行
      const result = await service.remove(1, 5, false)

      expect(result.message).toContain('1')
      expect(mockUpdate).toHaveBeenCalled()
    })
  })

  describe('restore', () => {
    it('文件不存在 → 抛 NotFoundException', async () => {
      mockFindFirst.mockResolvedValue(undefined)

      await expect(service.restore(999, 1, false)).rejects.toThrow(NotFoundException)
      expect(mockRename).not.toHaveBeenCalled()
    })

    it('文件未被删除 → 抛 ConflictException', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        deletedAt: null,
      })

      await expect(service.restore(1, 1, false)).rejects.toThrow(ConflictException)
    })

    it('非上传者非 admin → 抛 ForbiddenException', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        deletedAt: new Date(),
        uploadedBy: 2,
        trashPath: '/uploads-trash/123-a.png',
        path: '/uploads/a.png',
      })

      await expect(service.restore(1, 3, false)).rejects.toThrow(ForbiddenException)
    })

    it('恢复成功 → 磁盘文件还原 + DB 恢复', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        deletedAt: new Date(),
        uploadedBy: 5,
        trashPath: '/uploads-trash/123-a.png',
        path: '/uploads/a.png',
      })
      // 第一次 update: 条件抢锁（带 returning），第二次: 清空 trashPath
      mockUpdate
        .mockReturnValueOnce({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1, deletedAt: null }]),
            }),
          }),
        } as never)
        .mockReturnValueOnce({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        } as never)

      const result = await service.restore(1, 5, false)

      expect(result.message).toContain('1')
      expect(mockRename).toHaveBeenCalledWith('/uploads-trash/123-a.png', '/uploads/a.png')
      expect(mockUpdate).toHaveBeenCalledTimes(2)
    })

    it('trashPath 为空 → 仅恢复 DB，不还原磁盘', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        deletedAt: new Date(),
        uploadedBy: 5,
        trashPath: null,
        path: '/uploads/a.png',
      })
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, deletedAt: null }]),
          }),
        }),
      } as never)

      const result = await service.restore(1, 5, false)

      expect(result.message).toContain('1')
      expect(mockRename).not.toHaveBeenCalled()
      expect(mockUpdate).toHaveBeenCalledTimes(1)
    })
  })

  describe('upload 日配额（L6）', () => {
    const file = {
      originalname: 'a.png',
      path: '/uploads/a.png',
      size: 1,
      mimetype: 'image/png',
    }

    it('超配额 → 409 且清理 multer 临时文件', async () => {
      mockRedisQuota.incr.mockResolvedValue(101)

      await expect(service.upload(file as never, 7)).rejects.toThrow('今日上传次数已达上限')
      expect(mockUnlink).toHaveBeenCalledWith('/uploads/a.png')
    })

    it('未传 uploadedBy 跳过配额（内部调用路径）', async () => {
      await expect(service.upload(file as never)).rejects.toThrow()
      expect(mockRedisQuota.incr).not.toHaveBeenCalled()
    })
  })

  describe('purgeExpiredTrash', () => {
    const expiredRows = [
      { id: 1, path: '/u/a.png', trashPath: '/t/1-a.png' },
      { id: 2, path: '/u/b.png', trashPath: '/t/2-b.png' },
    ]

    function mockChains(rows: typeof expiredRows) {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(rows),
        }),
      })
      const deleteWhere = vi.fn().mockResolvedValue(undefined)
      mockDelete.mockReturnValue({ where: deleteWhere })
      return deleteWhere
    }

    it('超期软删文件：trashPath + 原 path 磁盘双清并硬删行', async () => {
      const deleteWhere = mockChains(expiredRows)

      const removed = await service.purgeExpiredTrash()

      expect(removed).toBe(2)
      expect(mockUnlink).toHaveBeenCalledWith('/t/1-a.png')
      expect(mockUnlink).toHaveBeenCalledWith('/u/a.png')
      expect(mockUnlink).toHaveBeenCalledTimes(4)
      expect(deleteWhere).toHaveBeenCalled()
    })

    it('无超期行 → 0，不动磁盘与 DB', async () => {
      mockChains([])

      const removed = await service.purgeExpiredTrash()

      expect(removed).toBe(0)
      expect(mockUnlink).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('unlink 失败不阻塞删行（孤儿行不得永存）', async () => {
      mockChains(expiredRows)
      mockUnlink.mockRejectedValue(new Error('EACCES'))

      const removed = await service.purgeExpiredTrash()

      expect(removed).toBe(2)
      expect(mockDelete).toHaveBeenCalled()
    })

    it('trashPath 为空的遗留行只清原 path', async () => {
      mockChains([{ id: 3, path: '/u/c.png', trashPath: null }])

      const removed = await service.purgeExpiredTrash()

      expect(removed).toBe(1)
      expect(mockUnlink).toHaveBeenCalledTimes(1)
      expect(mockUnlink).toHaveBeenCalledWith('/u/c.png')
    })
  })

  describe('ensureUploadDir', () => {
    it('创建上传目录（recursive）', async () => {
      await service.ensureUploadDir()

      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('uploads'), {
        recursive: true,
      })
    })
  })
})
