import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * L9：生产启动告警的落库与降级链路（进程级 e2e）。
 *
 * smoke 用 Test.createTestingModule 起 app，绕过了 main.ts 的 bootstrap()，
 * 因此「告警写入 error_logs」与「写库失败不阻断启动」两处此前零覆盖。
 * 本 spec 以真实子进程运行 bootstrap()，覆盖这两条不变量。
 *
 * 为什么先构建再跑 dist：tsx/esbuild 不产出 emitDecoratorMetadata，
 * 直接跑 src/main.ts 会让 Nest DI 拿不到构造参数类型（连 ConfigService 都注入失败）。
 *
 * 前置：e2e postgres + redis 已启动，且 DATABASE_URL 指向已迁移的库。
 */

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const BOOT_TIMEOUT_MS = 30_000
// 失败用例注入的库名：连接会被 PG 以 3D000 快速拒绝，无需额外建库权限
const MISSING_DB_NAME = 'monoforge_missing_db'

const baseDatabaseUrl = process.env.DATABASE_URL

interface RunningServer {
  child: ChildProcess
  stdout: () => string
  stderr: () => string
}

let suiteStartedAt: Date

function buildEnv(databaseUrl: string, port: number, dirs: { upload: string; backup: string }) {
  return {
    NODE_ENV: 'production',
    API_PORT: String(port),
    DATABASE_URL: databaseUrl,
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    JWT_SECRET: 'e2e-jwt-secret-must-be-at-least-32-chars-aaaaaaaa',
    JWT_REFRESH_SECRET: 'e2e-jwt-refresh-secret-must-be-at-least-32-chars-bbbb',
    COOKIE_SECURE: 'true',
    ALLOW_ORIGIN: 'http://localhost:3000',
    // 触发 L9 的核心生产告警；TRUST_PROXY=1 避免叠加无关告警
    ALLOW_THROTTLE_BYPASS: 'true',
    TRUST_PROXY: '1',
    UPLOAD_DIR: dirs.upload,
    BACKUP_DIR: dirs.backup,
    ALLOW_SETUP: 'false',
    ALLOW_REGISTER: 'false',
  } satisfies Record<string, string>
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function makeTempDirs() {
  const root = await mkdtemp(join(tmpdir(), 'mf-startup-'))
  return { root, upload: join(root, 'uploads'), backup: join(root, 'backups') }
}

function startServer(env: Record<string, string>): RunningServer {
  let out = ''
  let err = ''
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk) => {
    out += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    err += String(chunk)
  })
  return { child, stdout: () => out, stderr: () => err }
}

/** 轮询到任意 HTTP 响应即视为已 listen（失败用例的 503 同样是有效响应） */
async function waitForHttp(url: string): Promise<number> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  let lastError = 'unknown'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      return response.status
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`服务未在 ${BOOT_TIMEOUT_MS}ms 内就绪：${lastError}`)
}

async function stopServer(server: RunningServer): Promise<void> {
  const { child } = server
  if (child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5_000)),
  ])
  if (timedOut) child.kill('SIGKILL')
}

function buildPackage(filter: string): void {
  try {
    execFileSync('pnpm', [`--filter=${filter}`, 'build'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    })
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: Buffer }).stderr ?? '')
        : ''
    throw new Error(`构建 ${filter} 失败：${stderr || String(error)}`)
  }
}

describe('L9：生产启动告警落库与降级', () => {
  suiteStartedAt = new Date()

  beforeAll(() => {
    // dist 由 tsc 产出（含 decorator metadata），子进程才能真实执行 bootstrap()
    buildPackage('@monoforge/shared')
    buildPackage('server')
  }, 180_000)

  afterAll(async () => {
    if (!baseDatabaseUrl) return
    // 清理本 spec 产生的告警行，避免污染 e2e 库
    const sql = postgres(baseDatabaseUrl, { max: 1 })
    try {
      await sql`
        DELETE FROM error_logs
        WHERE source = 'backend'
          AND message LIKE ${'%ALLOW_THROTTLE_BYPASS%'}
          AND created_at >= ${suiteStartedAt}
      `
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  it('写库成功时生产告警写入 error_logs', { timeout: 60_000 }, async () => {
    expect(baseDatabaseUrl, '需要 DATABASE_URL 指向已迁移的 e2e 库').toBeTruthy()
    const port = await getFreePort()
    const dirs = await makeTempDirs()
    const server = startServer(buildEnv(baseDatabaseUrl!, port, dirs))

    try {
      const status = await waitForHttp(`http://127.0.0.1:${port}/api/v1/health`)
      expect(status).toBe(200)

      const sql = postgres(baseDatabaseUrl!, { max: 1 })
      try {
        const rows = await sql`
          SELECT id FROM error_logs
          WHERE source = 'backend'
            AND message LIKE ${'%ALLOW_THROTTLE_BYPASS%'}
            AND created_at >= ${suiteStartedAt}
        `
        expect(rows.length).toBeGreaterThan(0)
      } finally {
        await sql.end({ timeout: 5 })
      }
    } finally {
      await stopServer(server)
      await rm(dirs.root, { recursive: true, force: true })
    }
  })

  it('写库失败时进程仍启动并监听（503 即证据）', { timeout: 60_000 }, async () => {
    expect(baseDatabaseUrl, '需要 DATABASE_URL 以构造缺库连接串').toBeTruthy()
    const missingDbUrl = new URL(baseDatabaseUrl!)
    missingDbUrl.pathname = `/${MISSING_DB_NAME}`
    const port = await getFreePort()
    const dirs = await makeTempDirs()
    const server = startServer(buildEnv(missingDbUrl.toString(), port, dirs))

    try {
      const status = await waitForHttp(`http://127.0.0.1:${port}/api/v1/health`)
      // DB 不可用 → health 503；关键在服务已 listen，说明 record 失败未阻断 bootstrap
      expect(status).toBe(503)
      expect(server.child.exitCode).toBeNull()
      // console.warn 写 stderr，console.log 写 stdout；两路合并断言告警确实输出
      expect(`${server.stdout()}${server.stderr()}`).toContain('ALLOW_THROTTLE_BYPASS')
      expect(server.stderr()).not.toContain('[Bootstrap] 启动失败')
    } finally {
      await stopServer(server)
      await rm(dirs.root, { recursive: true, force: true })
    }
  })
})
