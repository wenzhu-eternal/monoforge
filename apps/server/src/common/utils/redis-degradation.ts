import { Logger } from '@nestjs/common'
import { appendErrorLog } from '@/common/logger'

/**
 * Q4：Redis fail-open 聚合观测。
 *
 * 全仓口径是"Redis 故障时降级放行"（不 fail-closed）：jti 黑名单 / 日配额 / 限流存储 /
 * 登录锁定等会静默跳过。单点日志已按分钟限频，但**持续故障**只表现为零星告警，
 * 无法区分"抖一下"与"已降级一小时"——本模块记录首次降级时刻，持续超阈值升级为
 * error_logs 告警（每阈值时长至多一条），恢复时清零。
 */
const UPGRADE_AFTER_MS = 5 * 60_000

const logger = new Logger('RedisDegradation')

let degradedSince: number | null = null
let lastUpgradeLogAt = 0

export function noteRedisDegraded(scope: string): void {
  const now = Date.now()
  if (degradedSince === null) {
    degradedSince = now
    return
  }
  const lastedMs = now - degradedSince
  if (lastedMs < UPGRADE_AFTER_MS) return
  if (now - lastUpgradeLogAt < UPGRADE_AFTER_MS) return

  lastUpgradeLogAt = now
  const message =
    `[Redis] 降级放行已持续 ${Math.round(lastedMs / 60_000)} 分钟（最近触发: ${scope}）：` +
    'jti 黑名单/日配额/限流存储等全部 fail-open，请尽快排查 Redis 可用性'
  // L10：error_logs 写入自身可能因聚合单点故障失败——同步打 stdout 日志链，
  // 保证外部采集（容器日志/平台）仍可见
  logger.error(message)
  appendErrorLog(message)
}

/** Redis 恢复正常时调用，重置降级计时 */
export function noteRedisRecovered(): void {
  degradedSince = null
  lastUpgradeLogAt = 0
}

/** 测试用：读取内部状态 */
export function getRedisDegradationState(): { degradedSince: number | null } {
  return { degradedSince }
}
