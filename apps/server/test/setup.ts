import { config } from 'dotenv'

/**
 * 测试环境变量设置
 *
 * 先加载根目录 .env（与 db/index.ts 一致），再为未设置的变量提供默认值
 * smoke.e2e-spec.ts 连真实 DB，需要正确的 DATABASE_URL/REDIS_URL
 */
config({ path: '../../.env' })

// 测试专用默认值（仅当未通过 .env 或环境变量传入时生效）
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db'
}
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = 'redis://localhost:6379'
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only-must-be-32-chars'
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-testing-only-must-be-32-chars'
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test'
}
// L15①：限流旁路改为显式开关，测试环境默认打开（生产误用 NODE_ENV=test 不再静默全放行）
if (!process.env.ALLOW_THROTTLE_BYPASS) {
  process.env.ALLOW_THROTTLE_BYPASS = 'true'
}
// L18：固定初始化开关为 false——smoke 的 POST /setup 负路径断言依赖默认关闭，
// 且防开发者 .env 开启开关后测试误初始化 e2e 库
process.env.ALLOW_SETUP = 'false'
