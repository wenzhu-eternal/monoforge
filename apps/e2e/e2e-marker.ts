import { execSync } from 'node:child_process'

/**
 * M3：e2e 运行环境指纹。
 *
 * webServer 把它注入 server/web env；server 在 /health 回显、web dev 中间件在 /__e2e__ 回显，
 * global-setup 比对不符即 fail-fast。目的：reuseExistingServer 只做健康探测，
 * 端口上悬挂的 dev server / 旧提交实例 / mock web 会让环境钉子与本次改动静默失效。
 */
export const E2E_MARKER = 'monoforge-e2e'

/**
 * M4：指纹 = 常量 + 当前提交短 SHA——旧提交启动的 dev web/server 也回显同一常量时，
 * 仅凭常量无法区分；带上 HEAD 后"复用旧进程"必然失配。
 */
export function makeRunMarker(): string {
  try {
    const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    return `${E2E_MARKER}:${head}`
  } catch {
    return `${E2E_MARKER}:unknown`
  }
}
