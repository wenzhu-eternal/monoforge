import { exec, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { CLEANUP_BATCH_SIZE, runCleanupInBatches } from '@/common/utils/cleanup-batch'
import {
  consumeDailyQuota,
  type DailyQuotaConsume,
  rollbackDailyQuota,
} from '@/common/utils/daily-quota'
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
// M2/L6：分批删除常量与执行器收敛到 common/utils/cleanup-batch，files 回收站清理共用同一口径

// M1：cron 停机错过零补偿——@nestjs/schedule 为标准 CronJob 无 catch-up，进程在窗口内
// 重启/宕机（滚动发布跨零点极常见）时当日备份静默消失。落最后成功时间戳，
// 由启动钩子与每小时孤儿清理校验，超过阈值即入库告警（每日去重）
const LAST_RUN_KEY_PREFIX = 'schedule:last-run:'
const LAST_RUN_TTL = 40 * 24 * 60 * 60
const BACKUP_FRESHNESS_MAX_HOURS = 25
const BACKUP_MISSING_ALERT_KEY_PREFIX = 'schedule:backup:missing-alert:'
// L3：SIGKILL/OOM 硬杀残留的 backup-*.sql.tmp 兜底清理阈值——正常备份 5min 内即定稿，
// 超 24h 仍是 .tmp 说明那轮已被硬杀、doBackup 的异常分支没机会跑
const STALE_BACKUP_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000
// L10：孤儿候选按批查 path，避免每小时把 files 全表拉进内存
const ORPHAN_PATH_QUERY_BATCH = 500

type ScheduleTask =
  | 'dailyBackup'
  | 'cleanOrphanUploads'
  | 'dailyTrashCleanup'
  | 'dailyNotificationCleanup'
  | 'dailyErrorLogsCleanup'
  // L1：手动备份独立键——与 cron 的 dailyBackup 分账，仅有 cron 键参与新鲜度校验
  | 'manualBackup'

type BackupResult = { status: 'ok' } | { status: 'busy' } | { status: 'failed'; error: string }

@Injectable()
export class ScheduleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduleService.name)

  constructor(
    private readonly mailService: MailService,
    private readonly errorLogsService: ErrorLogsService,
    private readonly redisService: RedisService,
    private readonly filesService: FilesService,
  ) {}

  /**
   * M1：启动即校验备份新鲜度——滚动发布跨零点会错过当日 0:00 的备份，
   * 而 CronJob 无 catch-up，需在启动时主动发现缺口
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.checkBackupFreshness()
  }

  /** M1：记录任务最后成功执行时间（Redis 故障只告警，不影响任务本身） */
  private async recordLastRun(task: ScheduleTask): Promise<void> {
    try {
      await this.redisService.set(
        `${LAST_RUN_KEY_PREFIX}${task}`,
        new Date().toISOString(),
        LAST_RUN_TTL,
      )
    } catch (err) {
      this.logger.warn(
        `记录 ${task} 执行时间失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** L4：清理任务失败需入库留痕——Nest logger 容器重建即失；自身失败兜底降级不反抛 */
  private async recordCleanupFailure(label: string, err: unknown): Promise<void> {
    const message = `${label}: ${err instanceof Error ? err.message : String(err)}`
    this.logger.error(message)
    try {
      await this.errorLogsService.record({ message, internal: true })
    } catch (recordErr) {
      this.logger.warn(
        `${label} 留痕写入失败: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
      )
    }
  }

  /**
   * M1：备份新鲜度校验——最后成功备份超过 25h（日备份 + 1h 余量）即入库告警。
   * 备份"跑失败"已有邮件 + error_logs 双留痕，但"根本没跑"原先零痕迹，最长 30 天无人发现。
   * 每日去重，避免 Redis 正常但 cron 停摆时每小时刷屏。
   */
  async checkBackupFreshness(): Promise<void> {
    if (!getEnv().ENABLE_BACKUP) return
    try {
      const raw = await this.redisService.get(`${LAST_RUN_KEY_PREFIX}dailyBackup`)
      // L5：无基线原先直接静默返回——新部署在首个 cron 前反复重启/预热错过时，
      // 心跳键永远为空，缺备份多日都无法自察。改为记一次低等级告警（每日去重），
      // 文案点明"新部署未到窗口"与"心跳键丢失"两种可能
      if (!raw) {
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const key = `${BACKUP_MISSING_ALERT_KEY_PREFIX}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}:nobaseline`
        if (await this.redisService.setNx(key, '1', 24 * 60 * 60)) {
          this.logger.warn(
            'ENABLE_BACKUP=true 但没有任何定时备份成功记录（新部署尚未到备份窗口，或心跳键丢失）',
          )
          await this.errorLogsService.record({
            message:
              '定时备份无成功基线：ENABLE_BACKUP=true 但未记录过任何成功备份，请确认是新部署尚未到窗口，还是心跳键丢失',
            context: { task: 'backupFreshness', reason: 'noBaseline' },
            internal: true,
          })
        }
        return
      }
      const lastRun = Date.parse(raw)
      if (Number.isNaN(lastRun)) return
      const hours = (Date.now() - lastRun) / 3_600_000
      if (hours <= BACKUP_FRESHNESS_MAX_HOURS) return

      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const alertKey = `${BACKUP_MISSING_ALERT_KEY_PREFIX}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      // L2：exists→set 两步 check-then-act 非原子，多实例并发可重复入库；改用 SETNX，抢到才告警
      const didClaim = await this.redisService.setNx(alertKey, '1', 24 * 60 * 60)
      if (!didClaim) return

      this.logger.error(
        `定时备份已 ${hours.toFixed(1)} 小时未成功执行（最后成功: ${raw}），请检查进程是否在备份窗口内重启`,
      )
      await this.errorLogsService.record({
        message: `定时备份已超过 ${BACKUP_FRESHNESS_MAX_HOURS} 小时未成功执行（最后成功时间: ${raw}）`,
        context: { task: 'backupFreshness', lastSuccessAt: raw },
        internal: true,
      })
    } catch (err) {
      this.logger.warn(`备份新鲜度校验失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

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
    const result = await this.doBackup()
    // L1：仅 cron 路径写 dailyBackup 心跳——手动备份成功不得计入，否则掩盖"定时备份停摆"
    if (result.status === 'ok') {
      await this.recordLastRun('dailyBackup')
    }
  }

  /**
   * 手动触发数据库备份（不受 ENABLE_BACKUP 开关限制，供 POST /schedule/backup 调用）
   */
  async manualBackup(userId?: number) {
    // L6：手动备份日配额——防持有者无频控制造整库 dump；未传 userId 的内部调用不受限
    // Q3：据 consume 返回值判断是否实扣，fail-open 时回滚不得 DECR
    // L2：日键随扣额返回，跨零点回滚不会退到新日键
    let quota: DailyQuotaConsume | null = null
    if (userId !== undefined) {
      quota = await consumeDailyQuota(
        this.redisService,
        'backup',
        userId,
        MANUAL_BACKUP_DAILY_LIMIT,
      )
    }
    const result = await this.doBackup()
    if (result.status === 'busy') {
      // L1：锁忙未实际执行 → 退还刚扣的配额，防连点把 3 次额度耗在 409 上、真需备份时被拒
      if (quota?.consumed) {
        try {
          await rollbackDailyQuota(this.redisService, quota.key)
        } catch (err) {
          this.logger.warn(`备份配额回滚失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      throw new ConflictException('已有备份任务进行中，请稍后再试')
    }
    // L7：失败已在 doBackup 内入库 + 发失败邮件；此处让调用者看到非 200，
    // 避免"手动备份失败仍回成功"的操作者视角静默
    // L5：500 只带通用文案——pg_dump 原始 stderr 常含 DB host/端口/库名，详情已留 error_logs/文件日志
    if (result.status === 'failed') {
      // 手动触发失败统一退还配额（原 doBackup 内退还，Q3 后移到调用方按实扣判定）
      if (quota?.consumed) {
        try {
          await rollbackDailyQuota(this.redisService, quota.key)
        } catch (rollbackErr) {
          this.logger.warn(
            `备份配额退还失败: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
          )
        }
      }
      throw new InternalServerErrorException('数据库备份执行失败，详情见 error_logs')
    }
    // L1：手动备份记独立键，与 cron 的 dailyBackup 心跳分账
    await this.recordLastRun('manualBackup')
  }

  /**
   * M6：每小时清理 uploads/ 孤儿文件——multer 超限/断传的临时文件落在 service 清理
   * 逻辑不可达之处（校验抛错早于落盘记录），永久残留。仅删同时满足：不在 files.path
   * 列、mtime 超 1h（进行中的上传不受影响）；失败只告警。
   */
  @Cron('0 * * * *')
  async cleanOrphanUploads() {
    // M1：每小时顺带校验备份新鲜度——错零点重启造成的备份缺口最迟 1 小时内可见
    await this.checkBackupFreshness()
    try {
      const uploadDir = getUploadDir()
      const entries = await readdir(uploadDir).catch(() => [] as string[])
      // L1：uploads 为空是常见稳态，不能提前 return——否则下方 trash 孤儿清扫整轮跳过
      if (entries.length > 0) {
        const cutoff = Date.now() - 3_600_000
        // L10：先按 mtime 筛出候选，再按批定点查询这些 path 是否在库里——
        // 原实现每小时 `select path` 全表拉取 + JS Set 构建，10 万行级即是常态化负载
        const candidates: string[] = []
        for (const name of entries) {
          const full = join(uploadDir, name)
          const st = await stat(full).catch(() => null)
          if (!st?.isFile() || st.mtimeMs > cutoff) continue
          candidates.push(full)
        }
        let removed = 0
        for (let i = 0; i < candidates.length; i += ORPHAN_PATH_QUERY_BATCH) {
          const chunk = candidates.slice(i, i + ORPHAN_PATH_QUERY_BATCH)
          const known = await db
            .select({ path: files.path })
            .from(files)
            .where(inArray(files.path, chunk))
          const knownSet = new Set(known.map((r) => r.path))
          for (const full of chunk) {
            if (knownSet.has(full)) continue
            await unlink(full).catch(() => null)
            removed += 1
          }
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
      if (trashEntries.length === 0) {
        await this.recordLastRun('cleanOrphanUploads')
        return
      }
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
        if (!st?.isFile() || st.mtimeMs > trashCutoff || knownTrash.has(full)) continue
        await unlink(full).catch(() => null)
        trashRemoved += 1
      }
      if (trashRemoved > 0) {
        this.logger.log(`清理 uploads-trash 孤儿文件 ${trashRemoved} 个`)
      }
      await this.recordLastRun('cleanOrphanUploads')
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
      await this.recordLastRun('dailyTrashCleanup')
    } catch (err) {
      await this.recordCleanupFailure('回收站清理失败', err)
    }
  }

  /**
   * M2：分批清理公共实现——每批按 ctid 子查询限流，避免单语句全表 DELETE 的 RETURNING 缓冲。
   * 批量口径与 files.purgeExpiredTrash 共用 runCleanupInBatches。
   */
  private async cleanupExpiredInBatches(
    runBatch: () => Promise<number>,
    label: string,
    retentionDays: number,
  ): Promise<void> {
    const total = await runCleanupInBatches(runBatch)
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
      await this.recordLastRun('dailyNotificationCleanup')
    } catch (err) {
      await this.recordCleanupFailure('通知清理失败', err)
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
      await this.recordLastRun('dailyErrorLogsCleanup')
    } catch (err) {
      await this.recordCleanupFailure('error_logs 清理失败', err)
    }
  }

  /**
   * 实际执行备份的逻辑：互斥锁 → pg_dump 导出 → 清理旧备份 → 邮件通知
   * L7：返回细化状态——'busy'（未抢到锁）/ 'failed'（执行失败）/ 'ok'，
   * 让手动触发能把失败暴露为 5xx，而非恒回"已执行"
   */
  private async doBackup(): Promise<BackupResult> {
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
      return { status: 'busy' }
    }

    // Q1：pg_dump 先写 .sql.tmp、成功后 rename 定稿——SIGKILL/OOM 硬杀只会留 .tmp，
    // 不会再有"半截 .sql"被 cleanOldBackups 当合法备份、恢复误用即数据缺失
    let filepath: string | undefined
    let tmpFilepath: string | undefined
    try {
      this.logger.log('开始执行数据库备份...')
      // M13：本地时间到秒（同日多次备份各写独立文件，原按日命名 + 截断写必然互相覆盖）
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      const filename = `backup-${timestamp}.sql`
      filepath = join(BACKUP_DIR, filename)
      tmpFilepath = `${filepath}.tmp`

      await mkdir(BACKUP_DIR, { recursive: true })

      const env = getEnv()
      // 支持自定义备份命令（如本机无 pg_dump 时用 docker exec 调用容器内的）
      if (env.BACKUP_CMD) {
        // 自定义命令保留 exec（可能含重定向如 docker exec … > {filepath}）；已在 env 层做白名单校验，
        // 此处再加超时防 cron 挂死，并告警提示审计
        this.logger.warn('使用自定义 BACKUP_CMD 执行备份，请确保该命令来源可信')
        const safeTmpFilepath = `'${tmpFilepath.replace(/'/g, "'\\''")}'`
        await execAsync(env.BACKUP_CMD.replaceAll('{filepath}', safeTmpFilepath), {
          timeout: 300_000,
          // L2：exec 子进程同样只给最小 env（PATH/LANG），不继承全量 process.env（含 JWT/MAIL 密钥）
          env: { PATH: process.env.PATH, LANG: process.env.LANG },
        })
      } else {
        if (!env.DATABASE_URL) {
          throw new Error('DATABASE_URL 未配置')
        }
        // pg_dump 用 spawn 参数数组，避免 shell 注入
        await this.spawnPgDump(env.DATABASE_URL, tmpFilepath)
      }
      // L26：定稿前校验产物大小——自定义 BACKUP_CMD 退出码 0 但重定向截断/空产物时，
      // 原实现直接 rename 定稿并邮件报"备份成功"，恢复时才发现不可用；
      // 校验失败抛错走异常分支，.tmp 被清掉，不会留下误导性的 .sql
      const tmpStats = await stat(tmpFilepath)
      if (tmpStats.size < env.BACKUP_MIN_BYTES) {
        throw new Error(
          `备份产物过小：${tmpStats.size} B < 下限 ${env.BACKUP_MIN_BYTES} B，疑似截断或空产物`,
        )
      }
      // Q1：写流完整落盘后才 rename 定稿（.tmp → .sql）
      await rename(tmpFilepath, filepath)

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
      // M1：备份产物已落盘即成功；心跳由调用方（cron/manual）各自记账，避免手动成功掩盖 cron 停摆
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.logger.error(`数据库备份失败: ${errorMsg}`)
      // Q1：失败路径只清 .tmp（半截或 rename 失败遗留的完整 tmp）；.sql 仅在 rename 成功后才存在，
      // 不会再出现"半截 .sql"（文件不存在/删失败均忽略，不影响错误上报链路）
      if (tmpFilepath) {
        await unlink(tmpFilepath).catch(() => null)
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
      // Q3：配额退还已上移到 manualBackup（按实扣判定），doBackup 不再据 userId 内退还
      return { status: 'failed', error: errorMsg }
    } finally {
      // 释放失败仅告警：锁有 TTL 兜底，不会永久卡死后续备份
      void this.redisService
        .del(BACKUP_LOCK_KEY)
        .catch((err) =>
          this.logger.warn(`备份锁释放失败: ${err instanceof Error ? err.message : String(err)}`),
        )
    }
    return { status: 'ok' }
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

      // L3：顺带清理被硬杀（SIGKILL/OOM）遗留的 backup-*.sql.tmp——doBackup 的异常分支
      // 没有机会执行时，这些半截产物会逐年堆积且无从辨别；早于阈值的一律清掉
      const nowMs = Date.now()
      for (const name of files.filter((f) => f.startsWith('backup-') && f.endsWith('.sql.tmp'))) {
        const st = await stat(join(BACKUP_DIR, name)).catch(() => null)
        if (!st || nowMs - st.mtimeMs < STALE_BACKUP_TMP_MAX_AGE_MS) continue
        try {
          await unlink(join(BACKUP_DIR, name))
          this.logger.log(`已清理残留备份临时文件: ${name}`)
        } catch (err) {
          this.logger.warn(
            `残留备份临时文件删除失败，跳过: ${name} (${err instanceof Error ? err.message : String(err)})`,
          )
        }
      }

      const backups = files.filter((f) => f.startsWith('backup-') && f.endsWith('.sql'))

      if (backups.length <= MAX_BACKUPS) {
        return
      }

      const resolved = await Promise.all(
        backups.map(async (file) => {
          const st = await stat(join(BACKUP_DIR, file)).catch(() => null)
          // L5：读不到 mtime 的文件不参与排序——避免因无法确认新旧而被当成最旧误删
          return st ? { file, mtimeMs: st.mtimeMs } : null
        }),
      )
      const entries = resolved.filter(
        (entry): entry is { file: string; mtimeMs: number } => entry !== null,
      )
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
      const toDelete = entries.slice(0, backups.length - MAX_BACKUPS).map((e) => e.file)

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
