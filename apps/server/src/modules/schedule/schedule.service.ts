import { exec, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
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
      if (customCmd) {
        // 自定义命令保留 exec（可能含 shell 语法如管道、变量）
        await execAsync(customCmd.replace('{filepath}', filepath))
      } else {
        const databaseUrl = this.configService.get<string>('DATABASE_URL')
        if (!databaseUrl) {
          throw new Error('DATABASE_URL 未配置')
        }
        // pg_dump 用 spawn 参数数组，避免 shell 注入
        await this.spawnPgDump(databaseUrl, filepath)
      }

      const stats = await stat(filepath)
      this.logger.log(`数据库备份成功: ${filename} (${(stats.size / 1024).toFixed(2)} KB)`)

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
      // 入库记录异常（兜底 try-catch，避免异常记录本身失败时变成未处理 rejection）
      try {
        await this.errorLogsService.record({
          message: `数据库备份失败: ${errorMsg}`,
          stack: err instanceof Error ? err.stack : undefined,
          context: { task: 'dailyBackup' },
        })
      } catch (recordErr) {
        this.logger.error(
          `备份异常入库失败: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
        )
      }
      try {
        await this.mailService.sendBackupNotification(false, errorMsg)
      } catch (mailErr) {
        this.logger.error(
          `备份失败通知邮件发送失败: ${mailErr instanceof Error ? mailErr.message : String(mailErr)}`,
        )
      }
    }
  }

  /**
   * 用 spawn 调用 pg_dump，参数数组形式避免 shell 注入
   */
  private spawnPgDump(databaseUrl: string, filepath: string): Promise<void> {
    const url = new URL(databaseUrl)
    const dbName = url.pathname.replace(/^\//, '')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(dbName),
    }
    return new Promise((resolve, reject) => {
      const child = spawn('pg_dump', ['--no-password', `--dbname=${dbName}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
      const stream = createWriteStream(filepath)
      child.stdout.pipe(stream)

      let stderr = ''
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('pg_dump 超时'))
      }, 300_000)

      const cleanup = () => {
        clearTimeout(timeout)
        child.kill()
      }

      child.on('error', (err) => {
        cleanup()
        reject(err)
      })
      child.on('close', (code) => {
        cleanup()
        if (code === 0) resolve()
        else reject(new Error(`pg_dump 退出码 ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`))
      })
      stream.on('error', (err) => {
        cleanup()
        reject(err)
      })
    })
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
