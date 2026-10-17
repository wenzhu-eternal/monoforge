import { adminUser, E2E_API_BASE, normalUser } from '@e2e/fixtures/users'
import type { Page, Request } from '@playwright/test'

/**
 * 浏览器登录辅助：通过 API 登录获取 token，注入 localStorage 实现"已登录状态"
 *
 * 避免每个测试都调 UI 登录触发 ThrottlerGuard 限流（60s 内 10 次即限流）
 * token 缓存在模块级变量，整个 e2e 套件只登录 2 次（admin + normalUser）
 * zustand persist 的 key 为 auth-storage，结构 { state: { token, user, isAuthenticated }, version: 0 }
 */

interface AuthUser {
  id: number
  username: string
  email: string
  nickname?: string
  roleId?: number
  status: boolean
  permissions?: string[]
}

interface LoginResult {
  accessToken: string
  user: AuthUser
}

// token 缓存（整个 e2e 套件复用，JWT 15 分钟内不会过期；超 10 分钟强制重登防死 token）
let adminToken: LoginResult | null = null
let normalUserToken: LoginResult | null = null
let adminLoginAt = 0
let normalUserLoginAt = 0
const LOGIN_CACHE_TTL_MS = 10 * 60 * 1000

async function apiLogin(username: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${E2E_API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    throw new Error(`登录失败 ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { code: number; data: LoginResult }
  return json.data
}

async function getAdminToken(): Promise<LoginResult> {
  if (!adminToken || Date.now() - adminLoginAt >= LOGIN_CACHE_TTL_MS) {
    adminToken = await apiLogin(adminUser.username, adminUser.password)
    adminLoginAt = Date.now()
  }
  return adminToken
}

async function getNormalUserToken(): Promise<LoginResult> {
  if (!normalUserToken || Date.now() - normalUserLoginAt >= LOGIN_CACHE_TTL_MS) {
    normalUserToken = await apiLogin(normalUser.username, normalUser.password)
    normalUserLoginAt = Date.now()
  }
  return normalUserToken
}

async function injectAuthState(page: Page, loginRes: LoginResult) {
  await page.addInitScript(
    ([token, user]) => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { token, user, isAuthenticated: true },
          version: 0,
        }),
      )
    },
    [loginRes.accessToken, loginRes.user] as const,
  )
}

/**
 * 用 admin 账号登录（注入 token，不调 UI 登录）
 * 调用后页面已处于 /dashboard
 */
export async function loginAsAdmin(page: Page) {
  const token = await getAdminToken()
  await injectAuthState(page, token)
  await page.goto('/dashboard')
  await page.waitForURL('**/dashboard', { timeout: 10_000 })
}

/**
 * 用普通用户账号登录（注入 token，不调 UI 登录）
 * 调用后页面已处于 /dashboard
 */
export async function loginAsNormalUser(page: Page) {
  const token = await getNormalUserToken()
  await injectAuthState(page, token)
  await page.goto('/dashboard')
  await page.waitForURL('**/dashboard', { timeout: 10_000 })
}

/**
 * 登出当前用户
 */
export async function logout(page: Page) {
  const logoutBtn = page.getByRole('button', { name: /退出|登出/ })
  if (await logoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await logoutBtn.click()
  } else {
    // 兜底：直接清 localStorage 跳回登录页
    await page.evaluate(() => {
      localStorage.removeItem('auth-storage')
    })
    await page.goto('/login')
  }
  await page.waitForURL('**/login', { timeout: 10_000 })
}

/**
 * 直接注入 token 到 localStorage，绕过 UI 登录
 * 用于「已登录状态」的快速测试场景，不模拟真实用户点击
 */
export async function injectToken(page: Page, token: string, user: unknown) {
  await injectAuthState(page, { accessToken: token, user: user as AuthUser })
}

/**
 * 等待指定 API 请求完成（用于断言前端发起了请求）
 */
export function waitForApiCall(
  page: Page,
  urlPattern: string | RegExp,
  method = 'GET',
): Promise<Request> {
  return page.waitForRequest(
    (req) => req.url().match(urlPattern) !== null && req.method().toUpperCase() === method,
  )
}
