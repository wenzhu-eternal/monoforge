import { config } from 'dotenv'
import postgres from 'postgres'

/**
 * M4：e2e 库物理重置——每次 e2e 启动前 DROP schema 重建。
 *
 * 背景：cleanup.ts 全走 API 软删，admin 列表含已删行，每轮新增可见行，
 * 长跑约 65~75 轮后夹具行滚出查找上限（findRowAcrossPages 50 页 × 10 条）而确定性假红，
 * 且全量列表清理耗时随轮次线性上升。放大翻页上限只是把假红推迟，重置才是确定态。
 *
 * 安全护栏：仅允许本地主机 + 库名含 e2e（或 CI 环境，CI service 库名为 test_db）。
 */
config({ path: '../../.env' })

// 与 playwright.config 的优先级对齐：优先选真正指向 e2e 库的连接串（候选间按库名判定），
// 避免 shell/root .env 里残留的 DEV DATABASE_URL 与 E2E_DATABASE_URL 混用时重置错库
const candidates = [process.env.E2E_DATABASE_URL, process.env.DATABASE_URL].filter(
  (value): value is string => !!value,
)
const connectionString =
  candidates.find((value) => new URL(value).pathname.includes('e2e')) ?? candidates[0]

if (!connectionString) {
  console.error('[ResetE2E] 未配置 E2E_DATABASE_URL / DATABASE_URL')
  process.exit(1)
}

const url = new URL(connectionString)
const dbName = url.pathname.replace(/^\//, '')
const host = url.hostname
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const isE2eDb = dbName.includes('e2e')
const isCi = process.env.CI === 'true'

if (!LOCAL_HOSTS.has(host) || (!isE2eDb && !isCi)) {
  console.error(
    `[ResetE2E] 拒绝重置：host=${host} db=${dbName}（仅允许本地主机 + 库名含 e2e，CI 环境另放行）`,
  )
  process.exit(1)
}

const run = async () => {
  const client = postgres(connectionString, { max: 1 })
  try {
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
    console.log(`[ResetE2E] 已重置数据库 ${dbName}`)
  } finally {
    await client.end()
  }
}

run().catch((err: Error) => {
  console.error('[ResetE2E] 重置失败:', err)
  process.exit(1)
})
