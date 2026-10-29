import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// E2E 测试配置（HTTP supertest，连真实 DB）
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// L24：test:e2e:ci 直跑时 npm script 层未做 E2E_DATABASE_URL 映射，setup.ts 会回退默认值；
// shell 残留的 DEV 连接串会让 migrate/seed 打到开发库——按库名指纹 fail-fast
const targetDbUrl: string =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://test:test@localhost:5432/test_db'
if (!/:5433\//.test(targetDbUrl) && !/\/test_db(\?|$)/.test(targetDbUrl)) {
  throw new Error(
    `[vitest-e2e] 拒绝非 e2e 数据库：${targetDbUrl}\n` +
      '  只允许 5433/monoforge_e2e_db 或 CI 的 test_db；请检查 shell 残留的 DATABASE_URL。',
  )
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    exclude: ['node_modules', 'dist', 'src/**'],
    setupFiles: ['./test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '../src'),
      '@shared': resolve(__dirname, '../../../packages/shared/src'),
    },
  },
})
