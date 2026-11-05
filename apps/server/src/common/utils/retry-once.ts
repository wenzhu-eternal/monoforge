/**
 * L6：失败重试一次的通用排空逻辑——成功返回 null，重试后仍失败返回最终错误。
 * auth/users 的两套 retryAndRecord/retryAndLog 原先各自内联同一段重试循环。
 */
export async function retryOnce(fn: () => Promise<unknown>): Promise<unknown | null> {
  try {
    await fn()
    return null
  } catch {
    try {
      await fn()
      return null
    } catch (retryErr) {
      return retryErr
    }
  }
}
