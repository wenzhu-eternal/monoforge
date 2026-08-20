import { join } from 'node:path'
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// 生产容器迁移入口：使用 drizzle-orm migrator（运行时依赖），
// 避免依赖 devDependency 的 drizzle-kit CLI；开发环境仍用 pnpm db:migrate
config({ path: '../../.env' })

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('[Migrate] DATABASE_URL 未配置')
  process.exit(1)
}

// 相对脚本位置定位迁移目录：src/db 与 dist/db 均上溯两级到 apps/server/drizzle，不受运行 cwd 影响
const migrationsFolder = join(__dirname, '..', '..', 'drizzle')

const runMigration = async () => {
  // 迁移用一次性连接，max=1 保证 schema 锁顺序（drizzle migrator 要求单连接）
  const client = postgres(connectionString, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder })
    console.log('[Migrate] 数据库迁移完成')
  } finally {
    await client.end()
  }
}

runMigration().catch((err: Error) => {
  console.error('[Migrate] 迁移失败:', err)
  process.exit(1)
})
