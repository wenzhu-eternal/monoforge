import { adminUser, E2E_API_BASE } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { expect, test } from '@playwright/test'

/**
 * 强制改密全链 e2e（L25）
 *
 * 覆盖：mustChangePassword 用户登录 → 拦截跳 /change-password → 改密 → 清态跳 /login
 */

test.describe('强制改密全链', () => {
  test('mustChangePassword 用户登录 → 跳改密页 → 改密后清态跳 /login', async ({ page }) => {
    // admin 登录（apiClient 复用 token），建 mustChangePassword=true 的临时用户
    await apiClient.login(adminUser.username, adminUser.password)
    const username = `e2e_chpass_${Date.now()}`
    const password = 'Pass1234'
    const newPassword = 'NewPass1234'
    const email = `e2e-chpass-${Date.now()}@test.com`

    const { status } = await apiClient.post(
      '/users',
      {
        username,
        email,
        password,
        nickname: 'e2e 改密',
        mustChangePassword: true,
      },
      201,
    )
    expect(status).toBe(201)

    // UI 登录 → mustChangePassword 用户直达改密页
    await page.goto('/login')
    await page.getByLabel('用户名').fill(username)
    await page.getByLabel('密码').fill(password)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/change-password$/, { timeout: 10_000 })

    // 改密（旧密码 + 新密码 + 确认）
    await page.getByLabel('旧密码', { exact: true }).fill(password)
    await page.getByLabel('新密码', { exact: true }).fill(newPassword)
    await page.getByLabel('确认新密码', { exact: true }).fill(newPassword)
    await page.getByRole('button', { name: '确认修改' }).click()

    // 改密后清态，跳回 /login
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 })

    // L18：闭环旧密码失效——原仅断言跳转，旧 RT 未被吊销/密码未真正落库时照绿
    const rawLogin = (pwd: string) =>
      fetch(`${E2E_API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: pwd }),
      })
    expect((await rawLogin(password)).status).toBe(401)
    expect((await rawLogin(newPassword)).status).toBe(200)
  })
})
