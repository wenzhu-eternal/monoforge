import { exec } from 'node:child_process'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { ErrorLogsService } from '@/modules/error-logs/error-logs.service'
import { MailService } from '@/modules/mail/mail.service'

const execAsync = promisify(exec)

const BACKUP_DIR = join(process.cwd(), 'backups')
const MAX_BACKUPS = 30

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly errorLogsService: ErrorLogsService,
  ) {}

  /**
   * 每天 0 点执行数据库备份
   * 使用 pg_dump 导出，保留最近 30 份
   */
  @Cron('0 0 * * *')
  async dailyBackup() {
    this.logger.log('开始执行数据库备份...')
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `backup-${timestamp}.sql`
    const filepath = join(BACKUP_DIR, filename)

    try {
      await mkdir(BACKUP_DIR, { recursive: true })

      // 支持自定义备份命令（如本机无 pg_dump 时用 docker exec 调用容器内的）
      const customCmd = this.configService.get<string>('BACKUP_CMD')
      const cmd = customCmd
        ? customCmd.replace('{filepath}', filepath)
        : (() => {
            const databaseUrl = this.configService.get<string>('DATABASE_URL')
            if (!databaseUrl) {
              throw new Error('DATABASE_URL 未配置')
            }
            return `pg_dump "${databaseUrl}" > "${filepath}"`
          })()
      await execAsync(cmd)

      const stats = await stat(filepath)
      this.logger.log(`数据库备份成功: ${filename} (${(stats.size / 1024).toFixed(2)} KB)`)

      // 清理旧备份，仅保留最近 MAX_BACKUPS 份
      await this.cleanOldBackups()

      // 发送备份成功通知（附带 .sql 附件）
      await this.mailService.sendBackupNotification(
        true,
        `${filename} (${(stats.size / 1024).toFixed(2)} KB)`,
        undefined,
        filepath,
      )
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.logger.error(`数据库备份失败: ${errorMsg}`)
      // 入库记录异常
      await this.errorLogsService.record({
        message: `数据库备份失败: ${errorMsg}`,
        stack: err instanceof Error ? err.stack : undefined,
        context: { task: 'dailyBackup' },
      })
      await this.mailService.sendBackupNotification(false, errorMsg)
    }
  }

  /**
   * 清理旧备份: 按修改时间排序，删除超出 MAX_BACKUPS 的旧文件
   */
  private async cleanOldBackups(): Promise<void> {
    try {
      const files = await readdir(BACKUP_DIR)
      const backups = files.filter((f) => f.startsWith('backup-') && f.endsWith('.sql'))

      if (backups.length <= MAX_BACKUPS) {
        return
      }

      // 按文件名（含日期）排序，旧的在前
      backups.sort()
      const toDelete = backups.slice(0, backups.length - MAX_BACKUPS)

      for (const file of toDelete) {
        await unlink(join(BACKUP_DIR, file))
        this.logger.log(`已清理旧备份: ${file}`)
      }
    } catch (err) {
      this.logger.warn('清理旧备份失败', err)
    }
  }
}
