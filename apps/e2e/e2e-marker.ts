/**
 * M3：e2e 运行环境指纹。
 *
 * webServer 把它注入 server env，server 在 /health 回显；global-setup 比对不符即 fail-fast。
 * 目的：reuseExistingServer 只做健康探测，9000 端口悬挂的 dev server 会让
 * E2E_DATABASE_URL / ALLOW_REGISTER / MAIL_HOST / THROTTLE_* 整串钉子静默失效。
 */
export const E2E_MARKER = 'monoforge-e2e'
