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

const { ScheduleService } = await import('./schedule.service')

describe('ScheduleService', () => {
  let service: InstanceType<typeof ScheduleService>
  let configService: { get: ReturnType<typeof vi.fn> }
  let mailService: { sendBackupNotification: ReturnType<typeof vi.fn> }
  let errorLogsService: { record: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockMkdir.mockClear().mockResolvedValue(undefined)
    mockStat.mockClear().mockResolvedValue({ size: 1024 })
    mockReaddir.mockClear().mockResolvedValue([])
    mockUnlink.mockClear().mockResolvedValue(undefined)

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'BACKUP_CMD') return undefined
        if (key === 'DATABASE_URL') return 'postgres://user:pass@localhost:5432/db'
        return undefined
      }),
    }
    mailService = { sendBackupNotification: vi.fn().mockResolvedValue(undefined) }
    errorLogsService = { record: vi.fn().mockResolvedValue(undefined) }

    service = new ScheduleService(
      configService as never,
      mailService as never,
      errorLogsService as never,
    )
  })

  // spyOn 私有方法 spawnPgDump，避免直接 mock node:child_process（vitest 对该 CJS 内置模块 mock 不稳定）
  function mockSpawnPgDump(impl: () => Promise<void>) {
    return vi.spyOn(service as never, 'spawnPgDump' as never).mockImplementation(impl as never)
  }

  describe('dailyBackup - spawn 成功路径', () => {
    it('spawnPgDump resolve → 备份成功并发送成功邮件', async () => {
      mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.dailyBackup()

      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(
        true,
        expect.stringContaining('backup-'),
      )
      // 成功路径不入库
      expect(errorLogsService.record).not.toHaveBeenCalled()
    })
  })

  describe('dailyBackup - spawn 失败路径', () => {
    it('spawnPgDump reject（pg_dump 退出码非 0） → 入库 + 发送失败邮件', async () => {
      mockSpawnPgDump(vi.fn().mockRejectedValue(new Error('pg_dump 退出码 1')))

      // dailyBackup 内部 catch 会吞错并入库，不向外抛
      await service.dailyBackup()

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
      mockSpawnPgDump(vi.fn().mockRejectedValue(new Error('pg_dump not found')))

      await service.dailyBackup()

      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('pg_dump not found'),
        }),
      )
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(false, 'pg_dump not found')
    })
  })

  describe('dailyBackup - DATABASE_URL 未配置', () => {
    it('抛错并入库', async () => {
      configService.get = vi.fn(() => undefined)

      // dailyBackup 内部 catch 会吞错并入库，不会向外抛
      await service.dailyBackup()

      expect(errorLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('DATABASE_URL 未配置'),
        }),
      )
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(false, 'DATABASE_URL 未配置')
    })
  })

  describe('dailyBackup - 自定义 BACKUP_CMD', () => {
    it('有 BACKUP_CMD 时不走 spawnPgDump', async () => {
      configService.get = vi.fn((key: string) => {
        if (key === 'BACKUP_CMD') return 'echo {filepath}'
        return undefined
      })
      const spawnSpy = mockSpawnPgDump(vi.fn().mockResolvedValue(undefined))

      await service.dailyBackup()

      // 自定义命令走 exec 不走 spawnPgDump
      expect(spawnSpy).not.toHaveBeenCalled()
      expect(mailService.sendBackupNotification).toHaveBeenCalledWith(true, expect.any(String))
    })
  })
})
