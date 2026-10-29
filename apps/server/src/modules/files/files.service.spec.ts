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

// Mock node:fs：existsSync 默认 false（M9 行态复检默认无漂移，个别用例显式开启）
const mockExistsSync = vi.fn().mockReturnValue(false)
vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}))

// Mock fs/promises（capture mkdir + rename 调用）
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockRename = vi.fn().mockResolvedValue(undefined)
const mockUnlink = vi.fn().mockResolvedValue(undefined)
vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  open: vi.fn().mockResolvedValue({
    read: vi.fn().mockImplementation((buffer: Buffer) => {
      buffer.set([0x89, 0x50, 0x4e, 0x47])
      return Promise.resolve([4, {}])
    }),
    close: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1 }),
  }),
  readFile: vi.fn().mockResolvedValue('\x89PNG\r\n\x1a\n'),
}))

const { FilesService } = await import('./files.service')

describe('FilesService', () => {
  let service: InstanceType<typeof FilesService>
  let mockRedisQuota: {
    eval: ReturnType<typeof vi.fn>
  }
  let mockErrorLogsService: {
    record: ReturnType<typeof vi.fn>
  }

  // M3/M9 共用：db.select 的 from→where→limit 链 mock
  const makeSelectChain = (rows: unknown[]) =>
    ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }) as never

  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockRename.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
    mockExistsSync.mockReturnValue(false)
    mockRedisQuota = {
      eval: vi.fn().mockResolvedValue(1),
    }
    mockErrorLogsService = {
      record: vi.fn().mockResolvedValue(undefined),
    }
    service = new FilesService(mockRedisQuota as never, mockErrorLogsService as never)
  })

  describe('remove', () => {
    // M3：postLock 复核查询默认命中（trashPath 匹配）且行态未漂移（deletedAt 仍非空）
    beforeEach(() => {
      mockSelect.mockReturnValue(
        makeSelectChain([{ trashPath: '/tmp/uploads-trash/12345-a.png', deletedAt: new Date() }]),
      )
    })
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
      expect(trashPath).toMatch(/uploads-trash\/[0-9a-z]+-a\.png$/)
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
      // L13：时间戳前缀完整保留（文件名分量截断），保证同毫秒删除不互相覆盖
      expect(trashPath).toMatch(/uploads-trash\/[0-9a-z]+-/)
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

    it('M9：搬盘后行态复检——并发 restore 已恢复行时把文件搬回原路径', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        path: '/uploads/a.png',
        filename: 'a.png',
        uploadedBy: 5,
      })
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      } as never)
      // 第一次 select：postLock 复核命中；第二次：M9 复检发现行已被并发 restore 恢复
      mockSelect
        .mockReturnValueOnce(
          makeSelectChain([{ trashPath: '/tmp/uploads-trash/12345-a.png', deletedAt: new Date() }]),
        )
        .mockReturnValueOnce(makeSelectChain([{ deletedAt: null, trashPath: null }]))

      await service.remove(1, 5, false)

      // 两次 rename：先搬进隔离目录，检测到漂移后补偿搬回原路径
      expect(mockRename).toHaveBeenCalledTimes(2)
      expect(mockRename.mock.calls[1]?.[0]).toContain('uploads-trash')
      expect(mockRename.mock.calls[1]?.[1]).toBe('/uploads/a.png')
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
    // M9：搬盘后行态复检默认无漂移（deletedAt 仍为 null，未被并发 remove 重新软删）
    beforeEach(() => {
      mockSelect.mockReturnValue(makeSelectChain([{ deletedAt: null, trashPath: null }]))
    })

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

    it('M9：搬盘后行态复检——并发 remove 已重新软删时把文件搬回行当前 trashPath', async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        deletedAt: new Date(),
        uploadedBy: 5,
        trashPath: '/uploads-trash/123-a.png',
        path: '/uploads/a.png',
      })
      // 第一次 update: 条件抢锁，第二次: 清空 trashPath
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
      // 搬盘后复检发现行已被并发 remove 重新软删（新 trashPath）
      mockSelect.mockReturnValue(
        makeSelectChain([{ deletedAt: new Date(), trashPath: '/uploads-trash/999-new.png' }]),
      )

      await service.restore(1, 5, false)

      // 两次 rename：先从隔离目录还原，检测到漂移后搬回行当前的新 trashPath
      expect(mockRename).toHaveBeenCalledTimes(2)
      expect(mockRename.mock.calls[0]).toEqual(['/uploads-trash/123-a.png', '/uploads/a.png'])
      expect(mockRename.mock.calls[1]).toEqual(['/uploads/a.png', '/uploads-trash/999-new.png'])
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
      // 配额检查在验证之后，需 mock fs 操作让验证通过
      mockUnlink.mockResolvedValue(undefined)
      const mockOpen = vi.fn().mockResolvedValue({
        read: vi.fn().mockImplementation((buffer: Buffer) => {
          buffer.set([0x89, 0x50, 0x4e, 0x47])
          return Promise.resolve([4, {}])
        }),
        close: vi.fn().mockResolvedValue(undefined),
        stat: vi.fn().mockResolvedValue({ size: 1, isFile: () => true }),
      })
      vi.spyOn(require('node:fs/promises'), 'open').mockImplementation(mockOpen)

      mockRedisQuota.eval.mockResolvedValue(101)

      await expect(service.upload(file as never, 7)).rejects.toThrow('今日上传次数已达上限')
      expect(mockUnlink).toHaveBeenCalledWith('/uploads/a.png')
    })

    it('未传 uploadedBy 跳过配额（内部调用路径）', async () => {
      await expect(service.upload(file as never)).rejects.toThrow()
      expect(mockRedisQuota.eval).not.toHaveBeenCalled()
    })

    it('M4 复现：配额检查抛 409（未扣额）时不触发 rollback，杜绝"注定失败请求退额"旁路', async () => {
      // consumeDailyQuota 抛 409 时 quotaConsumed 仍为 false → catch 不得 DECR。
      // 修复前无条件 rollback：一次必然 409 的请求也退一格，与成功上传交替即绕过 100/日上限
      mockRedisQuota.eval.mockResolvedValue(101)
      await expect(service.upload(file as never, 7)).rejects.toThrow(ConflictException)
      // eval 只被调用一次（consume INCR），绝不出现第二次 rollback DECR
      expect(mockRedisQuota.eval).toHaveBeenCalledTimes(1)
      expect(mockUnlink).toHaveBeenCalledWith('/uploads/a.png')
    })
  })

  describe('purgeExpiredTrash', () => {
    const expiredRows = [
      { id: 1, path: '/u/a.png', trashPath: '/t/1-a.png' },
      { id: 2, path: '/u/b.png', trashPath: '/t/2-b.png' },
    ]

    // M2 后的链路：条件 delete → returning 返回归属行 → 才允许清盘
    function mockChains(rows: Array<{ id: number; path: string; trashPath: string | null }>) {
      const deleteWhere = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(rows) })
      mockDelete.mockReturnValue({ where: deleteWhere })
      return deleteWhere
    }

    it('超期软删文件：returning 行磁盘双清，且删行先于清盘', async () => {
      const deleteWhere = mockChains(expiredRows)

      const removed = await service.purgeExpiredTrash()

      expect(removed).toBe(2)
      expect(mockUnlink).toHaveBeenCalledWith('/t/1-a.png')
      expect(mockUnlink).toHaveBeenCalledWith('/u/a.png')
      expect(mockUnlink).toHaveBeenCalledTimes(4)
      expect(deleteWhere).toHaveBeenCalled()
      // M2 核心顺序：行先硬删（returning 定归属）后才碰磁盘，与 restore 条件锁无共享窗口
      expect(mockDelete.mock.invocationCallOrder[0]).toBeLessThan(
        mockUnlink.mock.invocationCallOrder[0],
      )
    })

    it('无超期行 → 0，条件 delete 空命中不碰磁盘', async () => {
      mockChains([])

      const removed = await service.purgeExpiredTrash()

      expect(removed).toBe(0)
      expect(mockUnlink).not.toHaveBeenCalled()
    })

    it('unlink 失败不阻塞流程（行已先删，计数以 returning 为准）', async () => {
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

    // drizzle SQL 由嵌套 SQL/StringChunk/Column 组成，递归展平成文本供断言（不依赖方言渲染）
    function flattenSql(obj: unknown): string {
      const parts: string[] = []
      const walk = (v: unknown): void => {
        if (typeof v === 'string') {
          parts.push(v)
          return
        }
        if (!v || typeof v !== 'object') return
        const rec = v as { queryChunks?: unknown; value?: unknown; name?: unknown; table?: unknown }
        if (Array.isArray(rec.queryChunks)) {
          rec.queryChunks.forEach(walk)
          return
        }
        // StringChunk.value 为原始串数组；Param.value 为参数值（非串跳过）
        if (Array.isArray(rec.value)) rec.value.forEach(walk)
        else if (typeof rec.value === 'string') parts.push(rec.value)
        // Column：取列名（如 deleted_at），表名取不到时仅列名也足够断言
        else if (typeof rec.name === 'string' && rec.table != null) parts.push(rec.name)
      }
      walk(obj)
      return parts.join(' ')
    }

    it('F-1 复现：delete 必带过期复查（与删行同语句原子），窗口内被 restore 的行不硬删', async () => {
      // 场景：restore 与 purge 交错——条件复查（deleted_at is not null and < cutoff）
      // 与 delete 同语句执行，restore 抢锁赢则该行根本不命中删除条件
      const deleteWhere = mockChains(expiredRows)

      await service.purgeExpiredTrash()

      expect(deleteWhere).toHaveBeenCalled()
      const whereText = flattenSql(deleteWhere.mock.calls[0]?.[0])
      expect(whereText).toContain('deleted_at')
      expect(whereText).toMatch(/is not null/i)
      expect(whereText).toContain('<')
    })

    it('M2 复现：restore 抢锁赢的行不在 returning 内，其磁盘不被清', async () => {
      // 场景：select-then-删的旧链路里，purge 会无条件 unlink 全部查出行——
      // 已被 restore 搬回原路径的文件被物理删掉（DB 存活、磁盘双删）。
      // 新链路磁盘范围 = returning 行：被恢复的行不返回，两处路径均不得触碰
      mockChains([expiredRows[1]])

      const removed = await service.purgeExpiredTrash()

      expect(removed).toBe(1)
      expect(mockUnlink).not.toHaveBeenCalledWith('/t/1-a.png')
      expect(mockUnlink).not.toHaveBeenCalledWith('/u/a.png')
      expect(mockUnlink).toHaveBeenCalledWith('/t/2-b.png')
      expect(mockUnlink).toHaveBeenCalledWith('/u/b.png')
    })

    it('L6：满 5000 行后继续下一批，累计返回全量', async () => {
      const batch = Array.from({ length: 5000 }, (_, i) => ({
        id: i,
        path: `/u/${i}.png`,
        trashPath: null,
      }))
      const deleteWhere = vi
        .fn()
        .mockReturnValueOnce({ returning: vi.fn().mockResolvedValueOnce(batch) })
        .mockReturnValueOnce({
          returning: vi
            .fn()
            .mockResolvedValueOnce([{ id: 5001, path: '/u/last.png', trashPath: null }]),
        })
      mockDelete.mockReturnValue({ where: deleteWhere })

      const removed = await service.purgeExpiredTrash()

      expect(removed).toBe(5001)
      expect(mockDelete).toHaveBeenCalledTimes(2)
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
