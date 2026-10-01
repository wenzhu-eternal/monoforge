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

// getEnv mock：避免依赖真实 .env，单测内联控制环境变量
const mockGetEnv = vi.fn()
vi.mock('@/config/env', () => ({
  getEnv: (...args: unknown[]) => mockGetEnv(...(args as Parameters<typeof mockGetEnv>)),
}))

const { ScheduleService } = await import('./schedule.service')

describe('ScheduleService', () => {
  let service: InstanceType<typeof ScheduleService>
  let mailService: { sendBackupNotification: ReturnType<typeof vi.fn> }
  let errorLogsService: { record: ReturnType<typeof vi.fn> }
  let redisService: { setNx: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockMkdir.mockClear().mockResolvedValue(undefined)
    mockStat.mockClear().mockResolvedValue({ size: 1024 })
    mockReaddir.mockClear().mockResolvedValue([])
    mockUnlink.mockClear().mockResolvedValue(undefined)
    mockGetEnv.mockReset()

    mailService = { sendBackupNotification: vi.fn().mockResolvedValue(undefined) }
    errorLogsService = { record: vi.fn().mockResolvedValue(undefined) }
    // M13：默认抢锁成功，del 无害
    redisService = { setNx: vi.fn().mockResolvedValue(true), del: vi.fn().mockResolvedValue(1) }

    service = new ScheduleService(
      mailService as never,
      errorLogsService as never,
      redisService as never,
    )
  })

  // spyOn 私有方法 spawnPgDump，避免直接 mock node:child_process（vitest 对该 CJS 内置模块 mock 不稳定）
  function mockSpawnPgDump(impl: () => Promise<void>) {
    return vi.spyOn(service as never, 'spawnPgDump' as never).mockImplementation(impl as never)
  }

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
