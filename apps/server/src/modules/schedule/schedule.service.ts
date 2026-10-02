import { exec, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { getEnv } from '@/config/env'
import { db } from '@/db'
import { files } from '@/db/schema'
import { ErrorLogsService } from '@/modules/error-logs/error-logs.service'
import { MailService } from '@/modules/mail/mail.service'
import { RedisService } from '@/modules/redis/redis.service'

const execAsync = promisify(exec)

const BACKUP_DIR = join(process.cwd(), 'backups')
const MAX_BACKUPS = 30
// M13：备份进行中锁的 key 与 TTL（10min 兜底进程崩溃后死锁，备份链路本身 5min 超时）
const BACKUP_LOCK_KEY = 'schedule:backup:running'
const BACKUP_LOCK_TTL = 600

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name)

  constructor(
    private readonly mailService: MailService,
    private readonly errorLogsService: ErrorLogsService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 每天 0 点执行数据库备份（受 ENABLE_BACKUP 开关控制）
   */
  @Cron('0 0 * * *')
  async dailyBackup() {
    // 必须用 getEnv()：ConfigService 直读 process.env 拿到的是字符串 'false'（truthy），会导致开关失效
    const env = getEnv()
    if (!env.ENABLE_BACKUP) {
      this.logger.log('数据库备份未启用（ENABLE_BACKUP != true），跳过定时备份')
      return
    }
    await this.doBackup()
  }

  /**
   * 手动触发数据库备份（不受 ENABLE_BACKUP 开关限制，供 POST /schedule/backup 调用）
   */
  async manualBackup() {
    const executed = await this.doBackup()
    if (!executed) {
      throw new ConflictException('已有备份任务进行中，请稍后再试')
    }
  }

  /**
   * M6：每小时清理 uploads/ 孤儿文件——multer 超限/断传的临时文件落在 service 清理
   * 逻辑不可达之处（校验抛错早于落盘记录），永久残留。仅删同时满足：不在 files.path
   * 列、mtime 超 1h（进行中的上传不受影响）；失败只告警。
   */
  @Cron('0 * * * *')
  async cleanOrphanUploads() {
    try {
      const uploadDir = join(process.cwd(), 'uploads')
      const entries = await readdir(uploadDir).catch(() => [] as string[])
      if (entries.length === 0) return
      const known = await db.select({ path: files.path }).from(files)
      const knownSet = new Set(known.map((r) => r.path))
      const cutoff = Date.now() - 3_600_000
      let removed = 0
      for (const name of entries) {
        const full = join(uploadDir, name)
        const st = await stat(full).catch(() => null)
        if (!st || !st.isFile() || st.mtimeMs > cutoff || knownSet.has(full)) continue
        await unlink(full).catch(() => null)
        removed += 1
      }
      if (removed > 0) {
        this.logger.log(`清理 uploads 孤儿文件 ${removed} 个`)
      }
    } catch (err) {
      this.logger.warn(`孤儿文件清理失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 实际执行备份的逻辑：互斥锁 → pg_dump 导出 → 清理旧备份 → 邮件通知
   * 返回 false 表示未抢到锁（已有备份进行中），true 表示已执行（含执行失败）
   */
  private async doBackup(): Promise<boolean> {
    // M13：SETNX 互斥锁——cron 与手动触发（或连发）并发时两个 pg_dump 交叉截断写同一文件，
    // 产物静默损坏且邮件照报成功。Redis 异常时降级无锁执行（备份可用性优先，锁仅为并发防御）
    let locked = true
    try {
      locked = await this.redisService.setNx(
        BACKUP_LOCK_KEY,
        new Date().toISOString(),
        BACKUP_LOCK_TTL,
      )
    } catch (err) {
      this.logger.warn(
        `备份互斥锁获取异常，降级为无锁执行: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (!locked) {
      this.logger.warn('已有备份任务进行中，跳过本次触发')
      return false
    }

    try {
      this.logger.log('开始执行数据库备份...')
      // M13：本地时间到秒（同日多次备份各写独立文件，原按日命名 + 截断写必然互相覆盖）
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      const filename = `backup-${timestamp}.sql`
      const filepath = join(BACKUP_DIR, filename)

      await mkdir(BACKUP_DIR, { recursive: true })

      const env = getEnv()
      // 支持自定义备份命令（如本机无 pg_dump 时用 docker exec 调用容器内的）
      if (env.BACKUP_CMD) {
        // 自定义命令保留 exec（可能含重定向如 docker exec … > {filepath}）；已在 env 层做白名单校验，
        // 此处再加超时防 cron 挂死，并告警提示审计
        this.logger.warn('使用自定义 BACKUP_CMD 执行备份，请确保该命令来源可信')
        const safeFilepath = `'${filepath.replace(/'/g, "'\\''")}'`
        await execAsync(env.BACKUP_CMD.replace('{filepath}', safeFilepath), {
          timeout: 300_000,
          // L2：exec 子进程同样只给最小 env（PATH/LANG），不继承全量 process.env（含 JWT/MAIL 密钥）
          env: { PATH: process.env.PATH, LANG: process.env.LANG },
        })
      } else {
        if (!env.DATABASE_URL) {
          throw new Error('DATABASE_URL 未配置')
        }
        // pg_dump 用 spawn 参数数组，避免 shell 注入
        await this.spawnPgDump(env.DATABASE_URL, filepath)
      }

      const stats = await stat(filepath)
      this.logger.log(`数据库备份成功: ${filename} (${(stats.size / 1024).toFixed(2)} KB)`)

      await this.cleanOldBackups()

      // 发送备份成功通知（仅文字通知，不附 .sql 附件，避免整库数据经邮件外发）
      await this.mailService.sendBackupNotification(
        true,
        `${filename} (${(stats.size / 1024).toFixed(2)} KB)`,
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
    } finally {
      // 释放失败仅告警：锁有 TTL 兜底，不会永久卡死后续备份
      void this.redisService
        .del(BACKUP_LOCK_KEY)
        .catch((err) =>
          this.logger.warn(`备份锁释放失败: ${err instanceof Error ? err.message : String(err)}`),
        )
    }
    return true
  }

  /**
   * 用 spawn 调用 pg_dump，参数数组形式避免 shell 注入
   */
  private spawnPgDump(databaseUrl: string, filepath: string): Promise<void> {
    const url = new URL(databaseUrl)
    const dbName = url.pathname.replace(/^\//, '')
    // N3：库名经 PGDATABASE 环境变量传递（非 shell 拼接）本无注入面，仅拒绝空值与路径/空白等非法字符；
    // 合法 PG 库名可含连字符（如 my-db），原 ^\w+$ 过度校验直接导致备份抛错
    if (!/^[A-Za-z0-9_][A-Za-z0-9_$-]*$/.test(dbName)) {
      throw new Error('DATABASE_URL 库名非法')
    }
    // 仅透传最小环境 + PG*，避免全量 process.env（含 JWT/MAIL 密钥）泄露给子进程
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      LANG: process.env.LANG,
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

      // L7：close 只代表子进程退出，写流落盘可能滞后；跟踪 finish 后再 resolve，
      // 否则大库尾部页丢失却报成功
      let streamDone = false
      stream.once('finish', () => {
        streamDone = true
      })

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
        if (code !== 0) {
          cleanup()
          reject(new Error(`pg_dump 退出码 ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`))
          return
        }
        if (streamDone) {
          cleanup()
          resolve()
          return
        }
        stream.once('finish', () => {
          cleanup()
          resolve()
        })
      })
      stream.on('error', (err) => {
        cleanup()
        reject(err)
      })
    })
  }

  /**
   * 清理旧备份: 按文件名排序删除超出 MAX_BACKUPS 的旧文件。
   * 新命名 backup-YYYYMMDD-HHmmss.sql 零填充，字典序与时间序一致；
   * 与旧格式 backup-YYYYMMDD.sql 混存时同日旧格式排前（'-' < '.'），删除顺序仍正确。
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
