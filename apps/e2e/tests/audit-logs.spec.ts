import { adminUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { loginAsAdmin } from '@e2e/helpers/auth'
import { expect, test } from '@playwright/test'

/**
 * 审计日志 e2e（admin 视角）
 *
 * 覆盖：
 *   - admin 查看审计日志列表 → 有数据（前面 e2e 操作会产生审计日志）
 *   - 审计日志包含用户管理操作记录
 *   - 普通用户访问 /audit-logs → 403（在 routes.spec.ts 已覆盖，不重复）
 *
 * 依赖：global-setup + 之前 spec 的操作会产生审计日志（用户/角色/文件的增删改都会记录）
 */

test.beforeAll(async () => {
  await apiClient.login(adminUser.username, adminUser.password)
})

test.describe('审计日志（admin 视角）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('查看审计日志列表 → 有数据', async ({ page }) => {
    await page.goto('/audit-logs')
    await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible()
    // 前面 e2e 操作（用户/角色/文件增删改）会产生审计日志，列表应有数据
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10_000 })
  })

  test('审计日志包含用户管理操作记录', async ({ page }) => {
    // 先触发一次用户创建操作，确保有最新的审计日志（不传 roleId，服务端默认分配 user 角色）
    const tempUsername = `e2e_audit_${Date.now()}`
    const { data: createdUser } = await apiClient.post<{ id: number }>(
      '/users',
      {
        username: tempUsername,
        email: `${tempUsername}@test.com`,
        password: 'audit-password-123',
        nickname: '审计测试用户',
      },
      201,
    )
    if (!createdUser?.id) throw new Error('审计用例：创建临时用户未返回 id')

    await page.goto('/audit-logs')
    await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible()

    // L16：用动作筛选锁定"创建"，避免只断言首页（首页常被后续登录/删除记录挤出）
    await page.locator('.ant-form-item').filter({ hasText: '动作' }).locator('.ant-select').click()
    await page
      .locator('.ant-select-item')
      .filter({ hasText: /^创建$/ })
      .first()
      .click()
    await page.getByRole('button', { name: /搜\s*索/ }).click()

    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.ant-table-row').first()).toContainText('创建')
    // L17：锁到本次创建的那条业务行（资源ID=新建用户 id）——只看"任一行含创建"时
    // 匿名哨兵/错归属（userId=0）也照绿，恰是本用例该防的
    await expect(page.locator('.ant-table-row').first()).toContainText(String(createdUser.id))

    // 清理临时用户
    const { data: userList } = await apiClient.get<{
      list: Array<{ id: number; username: string }>
    }>('/users?pageSize=100')
    const tempUser = userList.list.find((u) => u.username === tempUsername)
    if (tempUser) {
      await apiClient.delete(`/users/${tempUser.id}`).catch(() => {})
    }
  })
})
