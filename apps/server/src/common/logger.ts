import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 日轮转文件日志: 每天一个文件 logs/error-YYYY-MM-DD.log
 * 作为 DB 错误日志的兜底，DB 抖动时不丢日志
 */
const LOG_DIR = join(process.cwd(), 'logs')

function getTodayLogPath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(LOG_DIR, `error-${date}.log`)
}

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
  } catch {
    // 目录已存在或无权限，忽略
  }
}

/**
 * 写入错误日志到文件（追加模式，不阻塞主流程的异常处理）
 * 格式: [ISO时间] [级别] 消息\n 堆栈\n
 */
export function appendErrorLog(message: string, stack?: string): void {
  try {
    ensureLogDir()
    const time = new Date().toISOString()
    const line = `[${time}] [ERROR] ${message}\n${stack ? `${stack}\n` : ''}\n`
    appendFileSync(getTodayLogPath(), line, 'utf8')
  } catch {
    // 文件写入失败不影响主流程，降级到控制台
    console.error('[FileLogger] 写入失败:', message)
  }
}
