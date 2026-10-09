import { defineConfig, devices } from '@playwright/test'

/**
 * MonoForge Playwright 全链路 e2e 配置
 *
 * 启动方式：
 *   1. docker compose up -d e2e-postgres redis  (e2e 专用 DB 5433 + dev redis 6379)
 *   2. pnpm test:e2e                              (webServer 自动起 server+web，并自动 db:push+seed)
 *
 * 端口策略：
 *   - e2e postgres: 5433  (独立容器 mf-e2e-postgres，与 DEV 5432 完全隔离，DEV DB 零污染)
 *   - redis:        6379  (复用 dev)
 *   - server:       9000  (复用 dev 端口，vite proxy 写死 9000)
 *   - web:          3000  (复用 dev 端口，vite.config.ts + check-port.mjs 写死 3000)
 *
 * 约束：e2e 跑时必须停 dev server + dev web（端口冲突）
 * 数据隔离：e2e 用独立 DB（monoforge_e2e_db），DEV DB 完全不受影响
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // 全链路 e2e 共享测试数据，串行避免冲突
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // 单 worker，共享浏览器上下文 + 数据库状态
  reporter: process.env.CI ? 'github' : 'html',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      // 启动前先重置 e2e DB（push schema + seed），确保每次跑都是干净状态
      command:
        'pnpm --filter=server db:push && pnpm --filter=server db:seed && pnpm --filter=@monoforge/server dev',
      url: 'http://localhost:9000/api/v1/health',
      // e2e 专用 DATABASE_URL 指向 5433 的 mf-e2e-postgres，与 DEV DB(5432) 完全隔离
      // THROTTLE_LIMIT 调高避免 e2e 频繁登录触发 429（.env 可保持生产值 10）
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://e2e_user:e2e_password@localhost:5433/monoforge_e2e_db',
        THROTTLE_LIMIT: '1000',
        // M7：webServer 内会重跑 db:seed，默认密码强制首登改密会踢飞 e2e 会话——显式豁免
        SEED_ADMIN_MUST_CHANGE_PASSWORD: 'false',
      },
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter=@monoforge/web dev',
      url: 'http://localhost:3000',
      env: {
        NODE_ENV: 'development',
      },
      timeout: 90_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
