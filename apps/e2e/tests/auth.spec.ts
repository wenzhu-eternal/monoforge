import { adminUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { logout, resetAuthTokenCache } from '@e2e/helpers/auth'
import { expect, test } from '@playwright/test'

/**
 * 认证链路 e2e
 *
 * 覆盖：
 *   - 登录成功 / 失败
 *   - 登出
 *   - 未登录访问受保护路由跳转
 *   - 登录后刷新保持登录（token 持久化）
 */

test.describe('认证链路', () => {
  test('登录成功 → 跳转 dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('用户名').fill(adminUser.username)
    await page.getByLabel('密码').fill(adminUser.password)
    await page.locator('button[type="submit"]').click()

    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible()
  })

  test('登录失败（错误密码）→ 显示错误提示', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('用户名').fill(adminUser.username)
    await page.getByLabel('密码').fill('wrong-password-xxx')
    await page.locator('button[type="submit"]').click()

    // antd message 错误提示
    await expect(page.locator('.ant-message-error')).toBeVisible({ timeout: 5000 })
    // 仍在登录页
    await expect(page).toHaveURL(/\/login$/)
  })

  test('登出 → 跳转登录页', async ({ page }) => {
    // 先登录
    await page.goto('/login')
    await page.getByLabel('用户名').fill(adminUser.username)
    await page.getByLabel('密码').fill(adminUser.password)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/dashboard$/)

    // 点右上角头像展开下拉后退出（helper 内已等待跳转 /login）
    await logout(page)

    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 })

    // 后端登出会吊销 admin 的全部 access token（含共享缓存），清掉后让后续用例重新登录
    apiClient.clearToken()
    resetAuthTokenCache()
  })

  test('未登录访问 /dashboard → 跳转 /login', async ({ page }) => {
    // 清空 localStorage 确保未登录
    await page.addInitScript(() => {
      localStorage.removeItem('auth-storage')
    })
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('未登录访问 /users → 跳转 /login', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('auth-storage')
    })
    await page.goto('/users')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('登录后刷新页面保持登录状态', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('用户名').fill(adminUser.username)
    await page.getByLabel('密码').fill(adminUser.password)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/dashboard$/)

    // 刷新页面，token 应该持久化
    await page.reload()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible()
  })
})
