import { ConflictException, InternalServerErrorException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// fs/promises mock（mkdir/stat/readdir/unlink）
const mockMkdir = vi.fn()
const mockStat = vi.fn()
const mockReaddir = vi.fn()
const mockUnlink = vi.fn()
const mockRename = vi.fn()
vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...(args as Parameters<typeof mockMkdir>)),
  stat: (...args: unknown[]) => mockStat(...(args as Parameters<typeof mockStat>)),
  readdir: (...args: unknown[]) => mockReaddir(...(args as Parameters<typeof mockReaddir>)),
  unlink: (...args: unknown[]) => mockUnlink(...(args as Parameters<typeof mockUnlink>)),
  rename: (...args: unknown[]) => mockRename(...(args as Parameters<typeof mockRename>)),
}))

// createWriteStream mock（避免真实写文件）
vi.mock('node:fs', () => ({
  createWriteStream: vi.fn(() => ({ on: vi.fn() })),
}))

// M12：dailyNotificationCleanup 直接用模块级 db（不走构造注入），mock 掉避免真库依赖
const mockReturning = vi.fn()
const mockWhere = vi.fn()
const mockDelete = vi.fn()
const mockSelect = vi.fn()
vi.mock('@/db', () => ({
  db: {
    delete: (...args: unknown[]) => mockDelete(...(args as Parameters<typeof mockDelete>)),
    select: (...args: unknown[]) => mockSelect(...(args as Parameters<typeof mockSelect>)),
  },
}))

// getEnv mock：避免依赖真实 .env，单测内联控制环境变量。
// 默认值补 DB_POOL_MAX——@/db 建池在模块加载期调 getEnv 消费它
const mockGetEnv = vi.fn((): Record<string, unknown> => ({ DB_POOL_MAX: 10 }))
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
    set: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    exists: ReturnType<typeof vi.fn>
  }
  let filesService: { purgeExpiredTrash: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockMkdir.mockClear().mockResolvedValue(undefined)
    mockStat.mockClear().mockResolvedValue({ size: 1024 })
    mockReaddir.mockClear().mockResolvedValue([])
    mockUnlink.mockClear().mockResolvedValue(undefined)
    mockRename.mockClear().mockResolvedValue(undefined)
    mockGetEnv.mockReset()

    mailService = { sendBackupNotification: vi.fn().mockResolvedValue(undefined) }
    errorLogsService = { record: vi.fn().mockResolvedValue(undefined) }
    // M13：默认抢锁成功，del 无害；L6：默认配额计数 1（Lua 原子 INCR 返回值）
    redisService = {
      setNx: vi.fn().mockResolvedValue(true),
      del: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      exists: vi.fn().mockResolvedValue(false),
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
    const spy = vi.spyOn(service as never, 'spawnPgDump' as never) as unknown as ReturnType<
      typeof vi.fn
    >
    return spy.mockImplementation(impl)
  }

  describe('cleanOrphanUploads（L1 空 uploads 仍清扫 trash）', () => {
    it('uploads 为空时仍执行 trash 孤儿清扫', async () => {
      const oldMtime = Date.now() - 31 * 24 * 60 * 60 * 1000
      mockReaddir.mockImplementation((dir: string) =>
        Promise.resolve(dir.endsWith('uploads-trash') ? ['orphan.sql'] : []),
      )
      mockStat.mockResolvedValue({ isFile: () => true, mtimeMs: oldMtime })
      mockSelect.mockReturnValue({
        from: () => ({ where: () => Promise.resolve([{ trashPath: '/known/other.sql' }]) }),
      })

      await service.cleanOrphanUploads()

      expect(mockUnlink).toHaveBeenCalledTimes(1)
      expect(String(mockUnlink.mock.calls[0][0])).toContain('orphan.sql')
    })

    it('L10：按候选批定点查 path，不再整表 select（10 万行级不再每小时全量拉取）', async () => {
      mockReaddir.mockImplementation((dir: string) =>
        Promise.resolve(dir.endsWith('uploads-trash') ? [] : ['orphan.png', 'fresh.png']),
      )
      const staleMs = Date.now() - 2 * 60 * 60 * 1000
      mockStat.mockImplementation((p: string) =>
        Promise.resolve({
          isFile: () => true,
          mtimeMs: p.includes('fresh.png') ? Date.now() : staleMs,
        }),
      )
      const whereSpy = vi.fn().mockResolvedValue([])
      const selectSpy = vi.fn().mockReturnValue({ from: () => ({ where: whereSpy }) })
      mockSelect.mockImplementation(selectSpy)

      await service.cleanOrphanUploads()

      // 仅一次定点查询（候选 batch），且 where 收到 inArray 条件而非无条件整表
      expect(selectSpy).toHaveBeenCalledTimes(1)
      expect(whereSpy).toHaveBeenCalledTimes(1)
      expect(whereSpy.mock.calls[0][0]).toBeDefined()
      // 只有超期且不在库内的候选被删；fresh.png 未过 mtime 阈值不进候选
      expect(mockUnlink).toHaveBeenCalledTimes(1)
      expect(String(mockUnlink.mock.calls[0][0])).toContain('orphan.png')
    })
  })

  describe('cleanOldBackups（L5 按 mtime 保留最新）', () => {
    it('新旧命名混存时删除 mtime 最旧的一份，而非字典序最小', async () => {
      const names = [
        'backup-20260101.sql',
        ...Array.from(
          { length: 30 },
          (_, i) => `backup-202601${String(i + 2).padStart(2, '0')}-000000.sql`,
        ),
      ]
      // 旧格式文件 mtime 最新：字典序会先删它，mtime 排序应保留它
      const mtime = new Map(names.map((n, i) => [n, i === 0 ? 9e12 : i]))
      mockReaddir.mockResolvedValue(names)
      mockStat.mockImplementation((p: string) => {
        const name = names.find((n) => p.endsWith(n))
        return Promise.resolve({ isFile: () => true, mtimeMs: mtime.get(name ?? '') })
      })

      await (service as unknown as { cleanOldBackups: () => Promise<void> }).cleanOldBackups()

      expect(mockUnlink).toHaveBeenCalledTimes(1)
      expect(String(mockUnlink.mock.calls[0][0])).toContain('backup-20260102-000000.sql')
    })

    it('L5：stat 失败的文件不参与排序，不被当成最旧误删', async () => {
      const names = [
        'backup-20260101.sql',
        ...Array.from(
          { length: 30 },
          (_, i) => `backup-202601${String(i + 2).padStart(2, '0')}-000000.sql`,
        ),
      ]
      mockReaddir.mockResolvedValue(names)
      mockStat.mockImplementation((p: string) => {
        // 最旧的候选文件无法 stat（并发删除/权限异常）
        if (p.endsWith('backup-20260102-000000.sql')) return Promise.reject(new Error('EACCES'))
        const index = names.findIndex((n) => p.endsWith(n))
        // 旧格式文件 mtime 最新，使不可读的 20260102 成为理论最旧
        return Promise.resolve({ isFile: () => true, mtimeMs: index === 0 ? 9e12 : index })
      })

      await (service as unknown as { cleanOldBackups: () => Promise<void> }).cleanOldBackups()

      // 跳过不可读文件后仍删除次旧的 backup-20260103
      expect(mockUnlink).toHaveBeenCalledTimes(1)
      expect(String(mockUnlink.mock.calls[0][0])).toContain('backup-20260103-000000.sql')
    })

    it('L3：硬杀残留的超期 .sql.tmp 顺带清理，未超期与正常 .sql 不动', async () => {
      const staleTmp = 'backup-20260101-000000.sql.tmp'
      const freshTmp = 'backup-20260102-000000.sql.tmp'
      const normal = 'backup-20260101.sql'
      mockReaddir.mockResolvedValue([staleTmp, freshTmp, normal])
      const staleMs = Date.now() - 25 * 60 * 60 * 1000
      mockStat.mockImplementation((p: string) =>
        Promise.resolve({
          isFile: () => true,
          size: 1024,
          mtimeMs: p.endsWith(staleTmp) ? staleMs : Date.now(),
        }),
      )

      await (service as unknown as { cleanOldBackups: () => Promise<void> }).cleanOldBackups()

      expect(mockUnlink).toHaveBeenCalledTimes(1)
      expect(String(mockUnlink.mock.calls[0][0])).toContain(staleTmp)
    })
  })

  describe('dailyTrashCleanup（J3 回收站到期清理）', () => {
    it('委托 filesService.purgeExpiredTrash', async () => {
      filesService.purgeExpiredTrash.mockResolvedValueOnce(3)

      await service.dailyTrashCleanup()

      expect(filesService.purgeExpiredTrash).toHaveBeenCalledTimes(1)
    })

    it('清理抛错只记录不外抛（cron 不因单次失败中断）', async () => {
      filesService.purgeExpiredTrash.mockRejectedValueOnce(new Error('disk error'))

      await expect(service.dailyTrashCleanup()).resolves.toBeUndefined()
      // L4：清理失败入库留痕（容器重建后 Nest 日志即失）
      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({ internal: true, message: expect.stringContaining('disk error') }),
      )
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
      // biome-ignore lint/complexity/useLiteralKeys: 测试需访问私有 logger
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
      // L4：清理失败入库留痕
      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({ internal: true, message: expect.stringContaining('db down') }),
      )
    })

    it('M2：超 5000 条按批删除，单语句不缓冲全表', async () => {
      mockReturning
        .mockResolvedValueOnce(Array.from({ length: 5000 }, (_, i) => ({ id: i })))
        .mockResolvedValueOnce([{ id: 5000 }])
      // biome-ignore lint/complexity/useLiteralKeys: 测试需访问私有 logger
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
      // biome-ignore lint/complexity/useLiteralKeys: 测试需访问私有 logger
      const logSpy = vi.spyOn(service['logger'], 'log')

      await service.dailyErrorLogsCleanup()

      expect(mockDelete).toHaveBeenCalledTimes(1)
      expect(mockReturning).toHaveBeenCalledWith({ id: expect.anything() })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 条'))
    })

    it('清理抛错只记录不外抛（cron 不因单次失败中断）', async () => {
      mockReturning.mockRejectedValue(new Error('db down'))

      await expect(service.dailyErrorLogsCleanup()).resolves.toBeUndefined()
      // L4：清理失败入库留痕
      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({ internal: true, message: expect.stringContaining('db down') }),
      )
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
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))
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

    it('L26：产物小于下限 → 按失败处理（不 rename 定稿、清 .tmp、发失败邮件）', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        BACKUP_MIN_BYTES: 1024,
      })
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))
      // 退出码 0 但重定向截断/空产物
      mockStat.mockResolvedValue({ size: 12 })

      await expect(service.manualBackup()).rejects.toThrow(InternalServerErrorException)

      expect(mockRename).not.toHaveBeenCalled()
      expect(mockUnlink).toHaveBeenCalled()
      expect(String(mockUnlink.mock.calls[0][0])).toContain('.sql.tmp')
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(
        false,
        expect.stringContaining('产物过小'),
      )
    })

    it('spawnPgDump reject（pg_dump 退出码非 0） → 入库 + 发送失败邮件 + L7 手动触发回 5xx', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockRejectedValue(new Error('pg_dump 退出码 1')))

      // L7：失败不再恒回成功——入库/邮件仍完成，但调用方看到 500
      // L5：500 只带通用文案，pg_dump stderr 不向调用方透出
      await expect(service.manualBackup()).rejects.toThrow(InternalServerErrorException)
      await expect(service.manualBackup()).rejects.toThrow('数据库备份执行失败，详情见服务端日志')

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

    it('spawnPgDump reject（pg_dump not found） → 入库 + 发送失败邮件 + 5xx', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockRejectedValue(new Error('pg_dump not found')))

      await expect(service.manualBackup()).rejects.toThrow(InternalServerErrorException)

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

      await expect(service.manualBackup()).rejects.toThrow(InternalServerErrorException)

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

      await expect(service.manualBackup()).rejects.toThrow(InternalServerErrorException)

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

  describe('M1 备份心跳与缺口告警', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

    it('备份成功后写入最后成功时间戳', async () => {
      mockGetEnv.mockReturnValue({
        ENABLE_BACKUP: true,
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.dailyBackup()

      expect(redisService.set).toHaveBeenCalledWith(
        'schedule:last-run:dailyBackup',
        expect.any(String),
        40 * 24 * 60 * 60,
      )
    })

    it('备份失败不写时间戳（避免把失败当成功基线）', async () => {
      mockGetEnv.mockReturnValue({
        ENABLE_BACKUP: true,
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockRejectedValue(new Error('pg_dump 退出码 1')))

      await service.dailyBackup()

      expect(redisService.set).not.toHaveBeenCalledWith(
        'schedule:last-run:dailyBackup',
        expect.any(String),
        expect.any(Number),
      )
    })

    it('L1：手动备份写独立键 manualBackup，不写 dailyBackup 心跳（避免掩盖 cron 停摆）', async () => {
      mockGetEnv.mockReturnValue({
        BACKUP_CMD: undefined,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      })
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.manualBackup()

      expect(redisService.set).toHaveBeenCalledWith(
        'schedule:last-run:manualBackup',
        expect.any(String),
        40 * 24 * 60 * 60,
      )
      expect(redisService.set).not.toHaveBeenCalledWith(
        'schedule:last-run:dailyBackup',
        expect.any(String),
        expect.any(Number),
      )
    })

    it('最后成功备份超过 25h → 入库告警并落去重键', async () => {
      mockGetEnv.mockReturnValue({ ENABLE_BACKUP: true })
      redisService.get.mockResolvedValue(hoursAgo(26))

      await service.checkBackupFreshness()

      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('超过 25 小时未成功执行'),
          internal: true,
        }),
      )
      // L2：去重用 SETNX 原子抢占，不再 exists→set 两步
      expect(redisService.setNx).toHaveBeenCalledWith(
        expect.stringContaining('schedule:backup:missing-alert:'),
        '1',
        24 * 60 * 60,
      )
    })

    it('未超过 25h → 不告警', async () => {
      mockGetEnv.mockReturnValue({ ENABLE_BACKUP: true })
      redisService.get.mockResolvedValue(hoursAgo(24))

      await service.checkBackupFreshness()

      expect(errorLogsService.record).not.toHaveBeenCalled()
    })

    it('L5：无基线（新部署/心跳键丢失）→ 记一次低等级告警，当日去重', async () => {
      mockGetEnv.mockReturnValue({ ENABLE_BACKUP: true })
      redisService.get.mockResolvedValue(null)

      await service.checkBackupFreshness()

      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('无成功基线'),
          internal: true,
        }),
      )
      expect(redisService.setNx).toHaveBeenCalledWith(
        expect.stringContaining(':nobaseline'),
        '1',
        24 * 60 * 60,
      )

      // 当日已告警（SETNX 抢锁失败）→ 不重复入库
      errorLogsService.record.mockClear()
      redisService.setNx.mockResolvedValue(false)
      await service.checkBackupFreshness()
      expect(errorLogsService.record).not.toHaveBeenCalled()
    })

    it('ENABLE_BACKUP=false → 不校验不告警', async () => {
      mockGetEnv.mockReturnValue({ ENABLE_BACKUP: false })
      redisService.get.mockResolvedValue(hoursAgo(48))

      await service.checkBackupFreshness()

      expect(redisService.get).not.toHaveBeenCalled()
      expect(errorLogsService.record).not.toHaveBeenCalled()
    })

    it('当日已告警 → 去重不重复入库', async () => {
      mockGetEnv.mockReturnValue({ ENABLE_BACKUP: true })
      redisService.get.mockResolvedValue(hoursAgo(26))
      // L2：SETNX 抢锁失败 = 已有实例当日告警过，跳过
      redisService.setNx.mockResolvedValue(false)

      await service.checkBackupFreshness()

      expect(errorLogsService.record).not.toHaveBeenCalled()
    })

    it('Redis 异常 → 只告警日志，不外抛（cron 不中断）', async () => {
      mockGetEnv.mockReturnValue({ ENABLE_BACKUP: true })
      redisService.get.mockRejectedValue(new Error('redis down'))

      await expect(service.checkBackupFreshness()).resolves.toBeUndefined()
      expect(errorLogsService.record).not.toHaveBeenCalled()
    })

    it('每小时孤儿清理顺带执行新鲜度校验', async () => {
      mockGetEnv.mockReturnValue({ ENABLE_BACKUP: true })
      redisService.get.mockResolvedValue(hoursAgo(26))

      await service.cleanOrphanUploads()

      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('超过 25 小时') }),
      )
    })
  })
})
