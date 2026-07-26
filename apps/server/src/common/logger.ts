import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 日轮转文件日志（DB 错误日志的兜底） */
const LOG_DIR = join(process.cwd(), 'logs')

function getTodayLogPath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(LOG_DIR, `error-${date}.log`)
}

async function ensureLogDir(): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true })
  } catch {
    // 目录已存在或无权限，忽略
  }
}

/** 异步写入队列: 将日志行缓存在内存中，定时批量刷盘，避免高并发 5xx 阻塞事件循环 */
const writeQueue: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(async () => {
    flushTimer = null
    if (writeQueue.length === 0) return

    const lines = writeQueue.splice(0)
    const content = lines.join('')

    try {
      await ensureLogDir()
      await appendFile(getTodayLogPath(), content, 'utf8')
    } catch {
      console.error('[FileLogger] 批量写入失败:', lines.length, '条日志')
    }
  }, 100)
}

/** 写入错误日志到文件（异步非阻塞） */
export function appendErrorLog(message: string, stack?: string): void {
  try {
    const time = new Date().toISOString()
    const line = `[${time}] [ERROR] ${message}\n${stack ? `${stack}\n` : ''}\n`
    writeQueue.push(line)
    scheduleFlush()
  } catch {
    // 序列化失败不影响主流程
    console.error('[FileLogger] 序列化失败:', message)
  }
}

/** 进程退出前刷空队列（用于 graceful shutdown） */
export async function flushErrorLog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (writeQueue.length === 0) return

  const lines = writeQueue.splice(0)
  const content = lines.join('')

  try {
    await ensureLogDir()
    await appendFile(getTodayLogPath(), content, 'utf8')
  } catch {
    console.error('[FileLogger] 最终写入失败:', lines.length, '条日志')
  }
}
