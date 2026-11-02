import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { adminUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { cleanupAll } from '@e2e/helpers/cleanup'

// L21：e2e 独立上传目录（与 playwright.config 的 UPLOAD_DIR 同源）
const e2eUploadDir = fileURLToPath(new URL('./uploads', import.meta.url))

/** L21：清理 uploads + uploads-trash，防软删 rename 与孤儿文件随轮次无界累积 */
async function cleanUploadArtifacts() {
  await rm(`${e2eUploadDir}-trash`, { recursive: true, force: true }).catch(() => undefined)
  await rm(e2eUploadDir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(e2eUploadDir, { recursive: true }).catch(() => undefined)
}

/**
 * Playwright 全局 teardown：所有测试后清理
 *
 * 流程：
 *   1. 重新用 admin 登录（token 可能已过期）
 *   2. 清理所有 e2e- 前缀的临时数据
 *
 * 注意：admin 账号 + seed 默认数据保留，不清理
 */
export default async function globalTeardown() {
  await cleanUploadArtifacts()
  console.log('[global-teardown] admin 重新登录...')
  try {
    await apiClient.login(adminUser.username, adminUser.password)
  } catch (err) {
    console.error('[global-teardown] 登录失败，跳过清理:', err)
    return
  }

  console.log('[global-teardown] 清理 e2e 数据...')
  await cleanupAll()

  console.log('[global-teardown] 完成')
}
