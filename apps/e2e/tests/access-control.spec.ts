import { apiClient } from '@e2e/helpers/api'
import { loginAsNormalUser } from '@e2e/helpers/auth'
import { expect, test } from '@playwright/test'

/**
 * 访问控制 e2e（路由级 403 守卫 + 公开注册开关）
 *
 * 覆盖：
 *   - 普通用户访问需权限路由（/files /mail /error-logs）→ 重定向 /403
 *   - ALLOW_REGISTER 关闭时 POST /auth/register → 404（隐藏端点存在性）
 */

test.describe('普通用户路由级 403 守卫（L25）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNormalUser(page)
  })

  for (const route of ['/files', '/mail', '/error-logs']) {
    test(`访问 ${route} → 重定向 /403`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/403$/, { timeout: 10_000 })
    })
  }
})

test.describe('公开注册开关（L25）', () => {
  test('ALLOW_REGISTER 关闭 → POST /auth/register 返回 404', async () => {
    const { status } = await apiClient.post('/auth/register', {
      username: `e2e_reg_${Date.now()}`,
      email: `e2e-reg-${Date.now()}@test.com`,
      password: 'Pass1234',
      code: '123456',
    })
    expect(status).toBe(404)
  })
})
