/**
 * 进程内 DB 写入登记表：用于优雅关闭时排空 fire-and-forget 写入。
 *
 * 背景：异常过滤器/审计等链路对错误日志采用 fire-and-forget（不阻塞响应），
 * 若 shutdown 直接 `client.end()`，尚未完成的 INSERT 会以 CONNECTION_ENDED 失败并打出噪声日志。
 * 关闭前先 drain 可让这些写入正常落库或自然失败，避免假告警。
 */
const pending = new Set<Promise<unknown>>()

/** 登记一次 DB 写入；返回原 promise，调用方仍可正常 await/catch */
export function trackDbWrite<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise)
  // 用派生 promise 清理登记，避免未捕获拒绝（原 promise 的拒绝仍由调用方处理）
  void promise
    .catch(() => undefined)
    .finally(() => {
      pending.delete(promise)
    })
  return promise
}

/**
 * 等待当前登记的全部写入落定（含失败），超时则放弃等待。
 * 快照语义：drain 期间新登记的写入不在本次等待范围（关闭阶段不应再有新请求）。
 */
export async function drainDbWrites(timeoutMs = 3_000): Promise<void> {
  if (pending.size === 0) return

  const settled = Promise.allSettled([...pending])
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([settled, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
