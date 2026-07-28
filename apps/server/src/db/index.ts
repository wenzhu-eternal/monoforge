import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// 显式加载根目录 .env，避免在 apps/server/ 下运行时找不到环境变量
config({ path: '../../.env' })

const connectionString = process.env.DATABASE_URL!

// 配置连接池: max 可配，默认 10；max_lifetime 30 分钟避免 stale 连接
// statement_timeout / idle_in_transaction_session_timeout 防止慢查询与长事务耗尽连接池
const connUrl = new URL(connectionString)
connUrl.searchParams.set('statement_timeout', '30000')
connUrl.searchParams.set('idle_in_transaction_session_timeout', '10000')
export const client = postgres(connUrl.toString(), {
  max: Number(process.env.DB_POOL_MAX) || 10,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 30 * 60,
})

export const db = drizzle(client, { schema })
