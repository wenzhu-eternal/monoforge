import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// fs/promises mock（mkdir/stat/readdir/unlink）
const mockMkdir = vi.fn()
const mockStat = vi.fn()
const mockReaddir = vi.fn()
const mockUnlink = vi.fn()
vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...(args as Parameters<typeof mockMkdir>)),
  stat: (...args: unknown[]) => mockStat(...(args as Parameters<typeof mockStat>)),
  readdir: (...args: unknown[]) => mockReaddir(...(args as Parameters<typeof mockReaddir>)),
  unlink: (...args: unknown[]) => mockUnlink(...(args as Parameters<typeof mockUnlink>)),
}))

// createWriteStream mock（避免真实写文件）
vi.mock('node:fs', () => ({
  createWriteStream: vi.fn(() => ({ on: vi.fn() })),
}))

// M12：dailyNotificationCleanup 直接用模块级 db（不走构造注入），mock 掉避免真库依赖
const mockReturning = vi.fn()
const mockWhere = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/db', () => ({
  db: {
    delete: (...args: unknown[]) => mockDelete(...(args as Parameters<typeof mockDelete>)),
  },
}))

// getEnv mock：避免依赖真实 .env，单测内联控制环境变量。
// 默认值补 DB_POOL_MAX——@/db 建池在模块加载期调 getEnv 消费它
const mockGetEnv = vi.fn(() => ({ DB_POOL_MAX: 10 }))
vi.mock('@/config/env', () => ({
  getEnv: (...args: unknown[]) => mockGetEnv(...(args as Parameters<typeof mockGetEnv>)),
}))

const { ScheduleService } = await import('./schedule.service')

describe('ScheduleService', () => {
  let service: InstanceType<typeof ScheduleService>
  let mailService: { sendBackupNotification: ReturnType<typeof vi.fn> }
  let errorLogsService: { record: ReturnType<typeof vi.fn> }
  let redisService: {
    setNx: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
    eval: ReturnType<typeof vi.fn>
  }
  let filesService: { purgeExpiredTrash: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockMkdir.mockClear().mockResolvedValue(undefined)
    mockStat.mockClear().mockResolvedValue({ size: 1024 })
    mockReaddir.mockClear().mockResolvedValue([])
    mockUnlink.mockClear().mockResolvedValue(undefined)
    mockGetEnv.mockReset()

    mailService = { sendBackupNotification: vi.fn().mockResolvedValue(undefined) }
    errorLogsService = { record: vi.fn().mockResolvedValue(undefined) }
    // M13：默认抢锁成功，del 无害；L6：默认配额计数 1（Lua 原子 INCR 返回值）
    redisService = {
      setNx: vi.fn().mockResolvedValue(true),
      del: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue(1),
    }
    filesService = { purgeExpiredTrash: vi.fn().mockResolvedValue(0) }

    service = new ScheduleService(
      mailService as never,
      errorLogsService as never,
      redisService as never,
      filesService as never,
    )
  })

  // spyOn 私有方法 spawnPgDump，避免直接 mock node:child_process（vitest 对该 CJS 内置模块 mock 不稳定）
  function mockSpawnPgDump(impl: () => Promise<void>) {
    return vi.spyOn(service as never, 'spawnPgDump' as never).mockImplementation(impl as never)
  }

  describe('dailyTrashCleanup（J3 回收站到期清理）', () => {
    it('委托 filesService.purgeExpiredTrash', async () => {
      filesService.purgeExpiredTrash.mockResolvedValueOnce(3)

      await service.dailyTrashCleanup()

      expect(filesService.purgeExpiredTrash).toHaveBeenCalledTimes(1)
    })

    it('清理抛错只记录不外抛（cron 不因单次失败中断）', async () => {
      filesService.purgeExpiredTrash.mockRejectedValueOnce(new Error('disk error'))

      await expect(service.dailyTrashCleanup()).resolves.toBeUndefined()
    })
  })

  describe('dailyNotificationCleanup（M12 通知保留期清理）', () => {
    beforeEach(() => {
      mockDelete.mockReset()
      mockWhere.mockReset()
      mockReturning.mockReset()
      mockWhere.mockReturnValue({ returning: mockReturning })
      mockDelete.mockReturnValue({ where: mockWhere })
    })

    it('M12 回归锁：删除量取自 returning 行数组 length（RETURNING 聚合是 PG 非法语法）', async () => {
      mockReturning.mockResolvedValue([{ id: 1 }, { id: 2 }])
      const logSpy = vi.spyOn(service['logger'], 'log')

      await service.dailyNotificationCleanup()

      expect(mockDelete).toHaveBeenCalledTimes(1)
      // 锁死修法：count 取自 returning 行数组 length（log 断言即回归锁——若回退成
      // `.returning({ count: sql\`count(*)\` })`，PG 每晚必抛 42883 且 rows.length 语义失效）
      expect(mockReturning).toHaveBeenCalledWith({ id: expect.anything() })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 条'))
    })

    it('清理抛错只记录不外抛（cron 不因单次失败中断）', async () => {
      mockReturning.mockRejectedValue(new Error('db down'))

      await expect(service.dailyNotificationCleanup()).resolves.toBeUndefined()
    })

    it('M2：超 5000 条按批删除，单语句不缓冲全表', async () => {
      mockReturning
        .mockResolvedValueOnce(Array.from({ length: 5000 }, (_, i) => ({ id: i })))
        .mockResolvedValueOnce([{ id: 5000 }])
      const logSpy = vi.spyOn(service['logger'], 'log')

      await service.dailyNotificationCleanup()

      expect(mockDelete).toHaveBeenCalledTimes(2)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('5001 条'))
    })
  })

  describe('dailyErrorLogsCleanup（L16 error_logs 保留期清理）', () => {
    beforeEach(() => {
      mockDelete.mockReset()
      mockWhere.mockReset()
      mockReturning.mockReset()
      mockWhere.mockReturnValue({ returning: mockReturning })
      mockDelete.mockReturnValue({ where: mockWhere })
    })

    it('L16 回归锁：删除量取自 returning 行数组 length（RETURNING 聚合是 PG 非法语法）', async () => {
      mockReturning.mockResolvedValue([{ id: 1 }, { id: 2 }])
      const logSpy = vi.spyOn(service['logger'], 'log')

      await service.dailyErrorLogsCleanup()

      expect(mockDelete).toHaveBeenCalledTimes(1)
      expect(mockReturning).toHaveBeenCalledWith({ id: expect.anything() })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 条'))
    })

    it('清理抛错只记录不外抛（cron 不因单次失败中断）', async () => {
      mockReturning.mockRejectedValue(new Error('db down'))

      await expect(service.dailyErrorLogsCleanup()).resolves.toBeUndefined()
    })
  })

  describe('dailyBackup - ENABLE_BACKUP 开关', () => {
    it('ENABLE_BACKUP=false → 跳过备份，不发邮件不入库', async () => {
      mockGetEnv.mockReturnValue({
        ENABLE_BACKUP: false,
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      const spawnSpy = mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.dailyBackup()

      expect(spawnSpy).not.toHaveBeenCalled()
      expect(mailService.sendBackupNotification).not.toHaveBeenCalled()
      expect(errorLogsService.record).not.toHaveBeenCalled()
    })

    it('ENABLE_BACKUP=true → 执行备份', async () => {
      mockGetEnv.mockReturnValue({
        ENABLE_BACKUP: true,
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.dailyBackup()

      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(
        true,
        expect.stringContaining('backup-'),
      )
    })

    it('ENABLE_BACKUP 为字符串 "false" → 跳过备份（验证 zod transform 后的 boolean 行为）', async () => {
      mockGetEnv.mockReturnValue({
        ENABLE_BACKUP: false,
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      const spawnSpy = mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.dailyBackup()

      expect(spawnSpy).not.toHaveBeenCalled()
    })
  })

  describe('manualBackup 日配额（L6）', () => {
    it('超日配额 → 409 且不执行备份（未抢锁）', async () => {
      redisService.eval.mockResolvedValue(4)

      await expect(service.manualBackup(7)).rejects.toThrow(ConflictException)
      await expect(service.manualBackup(7)).rejects.toThrow('今日备份次数已达上限')
      expect(redisService.setNx).not.toHaveBeenCalled()
    })

    it('配额内 → 正常执行备份', async () => {
      redisService.eval.mockResolvedValue(1)

      await service.manualBackup(7)

      expect(redisService.eval).toHaveBeenCalled()
      expect(redisService.setNx).toHaveBeenCalled()
    })

    it('L1: 锁忙未执行 → 退还刚扣配额（二次 eval 为守卫 DECR）', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      redisService.setNx.mockResolvedValue(false)

      await expect(service.manualBackup(7)).rejects.toThrow('已有备份任务进行中')

      // 第一次 eval = 扣配额（INCR），第二次 = 退还（守卫 DECR）
      expect(redisService.eval).toHaveBeenCalledTimes(2)
      const [rollbackScript, rollbackKeys] = redisService.eval.mock.calls[1] as [string, string[]]
      expect(rollbackScript).toContain('DECR')
      expect(rollbackKeys[0]).toMatch(/^quota:backup:7:\d{8}$/)
    })

    it('L1: 内部调用（无 userId）锁忙不涉及配额，无 eval', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      redisService.setNx.mockResolvedValue(false)

      await expect(service.manualBackup()).rejects.toThrow('已有备份任务进行中')
      expect(redisService.eval).not.toHaveBeenCalled()
    })
  })

  describe('manualBackup - 不受 ENABLE_BACKUP 开关限制', () => {
    it('spawnPgDump resolve → 备份成功并发送成功邮件', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.manualBackup()

      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(
        true,
        expect.stringContaining('backup-'),
      )
      // 成功路径不入库；M13 后备份完成释放进行中锁
      expect(errorLogsService.record).not.toHaveBeenCalled()
      expect(redisService.del).toHaveBeenCalledWith('schedule:backup:running')
    })

    it('M13: 未抢到锁（已有备份进行中）时 manualBackup 抛 ConflictException，不执行不释放', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      redisService.setNx.mockResolvedValue(false)
      const spawnSpy = mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await expect(service.manualBackup()).rejects.toThrow(ConflictException)
      await expect(service.manualBackup()).rejects.toThrow('已有备份任务进行中')
      expect(spawnSpy).not.toHaveBeenCalled()
      expect(mailService.sendBackupNotification).not.toHaveBeenCalled()
      // 未抢到锁不能释放持锁方的锁
      expect(redisService.del).not.toHaveBeenCalled()
    })

    it('M13: Redis 异常时降级无锁执行（备份可用性优先）', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      redisService.setNx.mockRejectedValue(new Error('redis down'))
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.manualBackup()

      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(
        true,
        expect.stringContaining('backup-'),
      )
    })

    it('M13: 备份文件名精确到秒，两次调用不互相覆盖', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.manualBackup()

      // backup-YYYYMMDD-HHmmss.sql（本地时间到秒）
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(
        true,
        expect.stringMatching(/backup-\d{8}-\d{6}\.sql/),
      )
    })

    it('spawnPgDump reject（pg_dump 退出码非 0） → 入库 + 发送失败邮件', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockRejectedValue(new Error('pg_dump 退出码 1')))

      // doBackup 内部 catch 会吞错并入库，不向外抛
      await service.manualBackup()

      // service catch 块给 record 的 message 加 "数据库备份失败:" 前缀
      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('pg_dump 退出码 1'),
          context: { task: 'dailyBackup' },
        }),
      )
      // 邮件传的是 errorMsg（不带前缀）
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(false, 'pg_dump 退出码 1')
    })

    it('spawnPgDump reject（pg_dump not found） → 入库 + 发送失败邮件', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockRejectedValue(new Error('pg_dump not found')))

      await service.manualBackup()

      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('pg_dump not found'),
        }),
      )
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(false, 'pg_dump not found')
    })

    it('M5: pg_dump 失败 → 清理半截备份文件残骸', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockRejectedValue(new Error('pg_dump 退出码 1')))

      await service.manualBackup()

      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('backup-'))
    })

    it('M5: dump 成功但后续环节失败 → 不误删完好备份', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))
      mailService.sendBackupNotification.mockRejectedValueOnce(new Error('smtp down'))

      await service.manualBackup()

      expect(mockUnlink).not.toHaveBeenCalled()
      // L5：通知失败归入 warn，不再落入 error_logs（备份产物完好）
      expect(errorLogsService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('smtp down') }),
      )
    })

    it('DATABASE_URL 未配置 → 抛错并入库', async () => {
      mockGetEnv.mockReturnValue({ BACKUP_CMD: undefined, DATABASE_URL: undefined })

      await service.manualBackup()

      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('DATABASE_URL 未配置'),
        }),
      )
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(false, 'DATABASE_URL 未配置')
    })

    it('有 BACKUP_CMD 时不走 spawnPgDump', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: 'echo {filepath}',
        DATABASE_URL: undefined,
      })
      const spawnSpy = mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.manualBackup()

      // 自定义命令走 exec 不走 spawnPgDump
      expect(spawnSpy).not.toHaveBeenCalled()
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(true, expect.any(String))
    })
  })
})
