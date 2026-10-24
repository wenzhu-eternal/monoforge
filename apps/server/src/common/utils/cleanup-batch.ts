/**
 * M2/L6：批量删除口径单源——单批 5000 行远低于 30s statement_timeout 阈值，
 * 避免 `DELETE … RETURNING` 一次性缓冲全表；批次间让出 100ms，防止清理打满连接池。
 */
export const CLEANUP_BATCH_SIZE = 5000
export const CLEANUP_BATCH_PAUSE_MS = 100

/**
 * 循环执行单批删除，直至某批不足 CLEANUP_BATCH_SIZE 视为清空；返回累计删除行数。
 */
export async function runCleanupInBatches(runBatch: () => Promise<number>): Promise<number> {
  let total = 0
  for (;;) {
    const removed = await runBatch()
    total += removed
    if (removed < CLEANUP_BATCH_SIZE) break
    await new Promise((resolve) => setTimeout(resolve, CLEANUP_BATCH_PAUSE_MS))
  }
  return total
}
