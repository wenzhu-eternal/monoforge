import { exec, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isNotNull, lt, sql } from 'drizzle-orm'
import { consumeDailyQuota, rollbackDailyQuota } from '@/common/utils/daily-quota'
import { getTrashDir, getUploadDir } from '@/common/utils/storage-dirs'
import { getEnv } from '@/config/env'
import { db } from '@/db'
import { files } from '@/db/schema'
import { errorLogs } from '@/db/schema/error-logs'
import { notifications } from '@/db/schema/notifications'
import { ErrorLogsService } from '@/modules/error-logs/error-logs.service'
import { FilesService, TRASH_RETENTION_DAYS } from '@/modules/files/files.service'
import { MailService } from '@/modules/mail/mail.service'
import { RedisService } from '@/modules/redis/redis.service'

const execAsync = promisify(exec)

// L13：目录可配（默认按 cwd 推导）；pm2/Docker 变更 WORKDIR 时用绝对路径锚定，防历史备份失联
const BACKUP_DIR = getEnv().BACKUP_DIR ?? join(process.cwd(), 'backups')
const MAX_BACKUPS = 30
// M13：备份进行中锁的 key 与 TTL（10min 兜底进程崩溃后死锁，备份链路本身 5min 超时）
const BACKUP_LOCK_KEY = 'schedule:backup:running'
const BACKUP_LOCK_TTL = 600
// L6：手动备份日配额（cron 每日 1 次走 doBackup 不经此处，不受限）
const MANUAL_BACKUP_DAILY_LIMIT = 3
// J1：通知保留期 90 天，与 files trash（30 天）口径对齐；error_logs 另有独立保留 cron（30 天）；audit_logs 不自动清，归档责任见 CONFIGURATION.md「保留与归档」
const NOTIFICATION_RETENTION_DAYS = 90
const ERROR_LOGS_RETENTION_DAYS = 30
// M2：单批删除量——避免 `DELETE … RETURNING` 一次性缓冲全表（postgres.js 全行组装后才 resolve，
// 叠加 30s statement_timeout 会首夜超时回滚并长期持锁），5000 行远低于超时阈值
const CLEANUP_BATCH_SIZE = 5000
// 批次间让出 100ms，避免清理把连接池/IO 打满影响在线请求
const CLEANUP_BATCH_PAUSE_MS = 100

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name)

  constructor(
    private readonly mailService: MailService,
    private readonly errorLogsService: ErrorLogsService,
    private readonly redisService: RedisService,
    private readonly filesService: FilesService,
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
  async manualBackup(userId?: number) {
    // L6：手动备份日配额——防持有者无频控制造整库 dump；未传 userId 的内部调用不受限
    if (userId !== undefined) {
      await consumeDailyQuota(this.redisService, 'backup', userId, MANUAL_BACKUP_DAILY_LIMIT)
    }
    const executed = await this.doBackup(userId)
    if (!executed) {
      // L1：锁忙未实际执行 → 退还刚扣的配额，防连点把 3 次额度耗在 409 上、真需备份时被拒
      if (userId !== undefined) {
        try {
          await rollbackDailyQuota(this.redisService, 'backup', userId)
        } catch (err) {
          this.logger.warn(`备份配额回滚失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
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
      const uploadDir = getUploadDir()
      const entries = await readdir(uploadDir).catch(() => [] as string[])
      // L1：uploads 为空是常见稳态，不能提前 return——否则下方 trash 孤儿清扫整轮跳过
      if (entries.length > 0) {
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
      }
    } catch (err) {
      this.logger.warn(`孤儿文件清理失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    // L8：同步清理 uploads-trash 中无 DB 行对应的孤立文件（M3 竞态窗口留下的残留）
    // 口径与 purgeExpiredTrash 一致：mtime 超 30 天且 DB 无对应行即视为孤儿
    try {
      const trashDir = getTrashDir()
      const trashEntries = await readdir(trashDir).catch(() => [] as string[])
      if (trashEntries.length === 0) return
      // trashPath 绝对路径集合用于快速排除已知行
      const trashRows = await db
        .select({ trashPath: files.trashPath })
        .from(files)
        .where(isNotNull(files.trashPath))
      const knownTrash = new Set(trashRows.map((r) => r.trashPath))
      const trashCutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
      let trashRemoved = 0
      for (const name of trashEntries) {
        const full = join(trashDir, name)
        const st = await stat(full).catch(() => null)
        if (!st || !st.isFile() || st.mtimeMs > trashCutoff || knownTrash.has(full)) continue
        await unlink(full).catch(() => null)
        trashRemoved += 1
      }
      if (trashRemoved > 0) {
        this.logger.log(`清理 uploads-trash 孤儿文件 ${trashRemoved} 个`)
      }
    } catch (err) {
      this.logger.warn(
        `uploads-trash 孤儿清理失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * J3：每天 0:30 清理回收站——超 30 天软删文件物理删除（磁盘 + 行），
   * 与 backups 30 份上限、error-logs deletedAt 口径对齐
   */
  @Cron('30 0 * * *')
  async dailyTrashCleanup() {
    try {
      const removed = await this.filesService.purgeExpiredTrash()
      if (removed > 0) {
        this.logger.log(`回收站清理：${removed} 个超期软删文件已物理删除`)
      }
    } catch (err) {
      this.logger.error(`回收站清理失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * M2：分批清理公共实现——每批按 ctid 子查询限流，避免单语句全表 DELETE 的 RETURNING 缓冲。
   * 单批不足 CLEANUP_BATCH_SIZE 即视为清空；批次间暂停，防止打满连接池。
   */
  private async cleanupExpiredInBatches(
    runBatch: () => Promise<number>,
    label: string,
    retentionDays: number,
  ): Promise<void> {
    let total = 0
    for (;;) {
      const removed = await runBatch()
      total += removed
      if (removed < CLEANUP_BATCH_SIZE) break
      await new Promise((resolve) => setTimeout(resolve, CLEANUP_BATCH_PAUSE_MS))
    }
    if (total > 0) {
      this.logger.log(
        `${label}：${total} 条超 ${retentionDays} 天已物理删除（createdAt 全量截断，分批）`,
      )
    }
  }

  // J1/M1：每天 0:30 清理超保留期的通知（90 天，createdAt 全量截断），audit_logs 不自动删仅文档声明归档责任
  @Cron('30 0 * * *')
  async dailyNotificationCleanup() {
    try {
      const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      await this.cleanupExpiredInBatches(
        async () => {
          // M12：RETURNING 不允许聚合函数（PG 42883），返回行数组再取 length 统计删除量；
          // M2：ctid 子查询只取单批，RETURNING 也仅缓冲 5000 行
          const rows = await db
            .delete(notifications)
            .where(
              sql`ctid IN (SELECT ctid FROM ${notifications} WHERE ${lt(notifications.createdAt, cutoff)} LIMIT ${CLEANUP_BATCH_SIZE})`,
            )
            .returning({ id: notifications.id })
          return rows.length
        },
        '通知清理',
        NOTIFICATION_RETENTION_DAYS,
      )
    } catch (err) {
      this.logger.error(`通知清理失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // L16：error_logs 保留 cron——与通知同款，每天 1:30 执行，createdAt 全量截断
  @Cron('30 1 * * *')
  async dailyErrorLogsCleanup() {
    try {
      const cutoff = new Date(Date.now() - ERROR_LOGS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      await this.cleanupExpiredInBatches(
        async () => {
          // M12：RETURNING 不允许聚合函数（PG 42883），返回行数组再取 length 统计删除量；
          // M2：ctid 子查询只取单批，RETURNING 也仅缓冲 5000 行
          const rows = await db
            .delete(errorLogs)
            .where(
              sql`ctid IN (SELECT ctid FROM ${errorLogs} WHERE ${lt(errorLogs.createdAt, cutoff)} LIMIT ${CLEANUP_BATCH_SIZE})`,
            )
            .returning({ id: errorLogs.id })
          return rows.length
        },
        'error_logs 清理',
        ERROR_LOGS_RETENTION_DAYS,
      )
    } catch (err) {
      this.logger.error(`error_logs 清理失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 实际执行备份的逻辑：互斥锁 → pg_dump 导出 → 清理旧备份 → 邮件通知
   * 返回 false 表示未抢到锁（已有备份进行中），true 表示已执行（含执行失败）
   */
  private async doBackup(userId?: number): Promise<boolean> {
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

    // M5：失败时清理半截产物——pg_dump 中途失败/超时会留下截断的 .sql，
    // 后续恢复误用即数据缺失；cleanOldBackups 也会把它当合法备份计数。
    // dump 已完成（如后续 stat/邮件环节）则不删——那是完好产物
    let filepath: string | undefined
    let dumpCompleted = false
    try {
      this.logger.log('开始执行数据库备份...')
      // M13：本地时间到秒（同日多次备份各写独立文件，原按日命名 + 截断写必然互相覆盖）
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      const filename = `backup-${timestamp}.sql`
      filepath = join(BACKUP_DIR, filename)

      await mkdir(BACKUP_DIR, { recursive: true })

      const env = getEnv()
      // 支持自定义备份命令（如本机无 pg_dump 时用 docker exec 调用容器内的）
      if (env.BACKUP_CMD) {
        // 自定义命令保留 exec（可能含重定向如 docker exec … > {filepath}）；已在 env 层做白名单校验，
        // 此处再加超时防 cron 挂死，并告警提示审计
        this.logger.warn('使用自定义 BACKUP_CMD 执行备份，请确保该命令来源可信')
        const safeFilepath = `'${filepath.replace(/'/g, "'\\''")}'`
        await execAsync(env.BACKUP_CMD.replaceAll('{filepath}', safeFilepath), {
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
      dumpCompleted = true

      const stats = await stat(filepath)
      this.logger.log(`数据库备份成功: ${filename} (${(stats.size / 1024).toFixed(2)} KB)`)

      await this.cleanOldBackups()

      // 发送备份成功通知（仅文字通知，不附 .sql 附件，避免整库数据经邮件外发）
      // L5：通知失败不归入"备份失败"——.sql 完好且保留，错误记录与原产物矛盾
      try {
        await this.mailService.sendBackupNotification(
          true,
          `${filename} (${(stats.size / 1024).toFixed(2)} KB)`,
        )
      } catch (mailErr) {
        this.logger.warn(
          `备份成功但通知邮件发送失败: ${mailErr instanceof Error ? mailErr.message : String(mailErr)}`,
        )
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.logger.error(`数据库备份失败: ${errorMsg}`)
      // M5：清理失败残留的半截备份文件（文件不存在/删失败均忽略，不影响错误上报链路）
      if (filepath && !dumpCompleted) {
        await unlink(filepath).catch(() => null)
      }
      // 入库记录异常（兜底 try-catch，避免异常记录本身失败时变成未处理 rejection）
      try {
        await this.errorLogsService.record({
          message: `数据库备份失败: ${errorMsg}`,
          stack: err instanceof Error ? err.stack : undefined,
          context: { task: 'dailyBackup' },
          internal: true,
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
      // L11/L9：filepath 在一切检查前赋值，走到 catch 即已经扣额（手动触发）且备份未成功，
      // 统一退还配额并返回 true，让 manualBackup 正常走错误上报/失败邮件流程；
      // 只有 filepath 赋值前（当前不可达）的异常才向外抛
      if (filepath && userId !== undefined) {
        try {
          await rollbackDailyQuota(this.redisService, 'backup', userId)
        } catch (rollbackErr) {
          this.logger.warn(
            `备份配额退还失败: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
          )
        }
      }
      return true
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
   * 清理旧备份: 保留最近 MAX_BACKUPS 份，按文件 mtime 排序删除最旧的。
   * L5：不用字面量字典序——新格式 backup-YYYYMMDD-HHmmss.sql 与旧格式 backup-YYYYMMDD.sql
   * 混存时 '-'(45) < '.'(46)，字典序会把新备份排在旧备份前，反而先删最新。
   */
  private async cleanOldBackups(): Promise<void> {
    try {
      const files = await readdir(BACKUP_DIR)
      const backups = files.filter((f) => f.startsWith('backup-') && f.endsWith('.sql'))

      if (backups.length <= MAX_BACKUPS) {
        return
      }

      const entries = await Promise.all(
        backups.map(async (file) => {
          const st = await stat(join(BACKUP_DIR, file)).catch(() => null)
          return { file, mtimeMs: st?.mtimeMs ?? 0 }
        }),
      )
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
      const toDelete = entries.slice(0, entries.length - MAX_BACKUPS).map((e) => e.file)

      for (const file of toDelete) {
        // L10：单文件删除失败（与并发备份窗口交叠时 ENOENT）不中断整轮清理
        try {
          await unlink(join(BACKUP_DIR, file))
          this.logger.log(`已清理旧备份: ${file}`)
        } catch (err) {
          this.logger.warn(
            `旧备份删除失败，跳过: ${file} (${err instanceof Error ? err.message : String(err)})`,
          )
        }
      }
    } catch (err) {
      this.logger.warn('清理旧备份失败', err)
    }
  }
}
