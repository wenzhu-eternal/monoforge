import { adminUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { loginAsAdmin } from '@e2e/helpers/auth'
import { expect, test } from '@playwright/test'

/**
 * 错误日志 e2e（admin 视角）
 *
 * 覆盖：
 *   - 页面正常渲染 + 两个 Tab 切换
 *   - 触发前端错误上报 → 列表出现新错误
 *   - 统计面板显示（总数/未处理/前端/后端）
 *   - 标记已处理 → 状态变更
 *   - 白名单 Tab：新增/禁用白名单规则
 */

test.beforeAll(async () => {
  await apiClient.login(adminUser.username, adminUser.password)
})

test.describe('错误日志（admin 视角）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('页面渲染 + Tab 切换', async ({ page }) => {
    await page.goto('/error-logs')
    await expect(page.getByRole('heading', { name: '错误日志' })).toBeVisible()

    // 默认在"错误日志"Tab（aria-selected=true 表示选中）
    await expect(page.getByRole('tab', { name: '错误日志', selected: true })).toBeVisible()

    // 切换到"白名单规则"
    await page.getByRole('tab', { name: '白名单规则' }).click()
    await expect(page.getByRole('button', { name: '新增白名单' })).toBeVisible()

    // 切换回"错误日志"
    await page.getByRole('tab', { name: '错误日志' }).click()
  })

  test('统计面板显示 4 个指标', async ({ page }) => {
    await page.goto('/error-logs')
    // 等待统计数据加载
    await expect(page.getByText('总错误数').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('未处理').first()).toBeVisible()
    await expect(page.getByText('前端错误').first()).toBeVisible()
    await expect(page.getByText('后端错误').first()).toBeVisible()
  })

  test('触发前端错误上报 → 列表出现新错误', async ({ page }) => {
    // 先记录当前错误总数
    await page.goto('/error-logs')
    await expect(page.getByText('总错误数').first()).toBeVisible({ timeout: 10_000 })

    // 通过 API 上报一条前端错误（/error-logs/report 是 @Public 接口）
    const errorMessage = `e2e-frontend-error-${Date.now()}`
    const res = await fetch('http://localhost:9000/api/v1/error-logs/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'frontend',
        errorType: 'js_error',
        message: errorMessage,
        stack: 'Error: e2e test\n  at test:1:1',
        url: 'http://localhost:3000/error-logs',
      }),
    })
    expect(res.ok).toBe(true)

    // 刷新页面，搜索刚上报的错误
    await page.reload()
    await page.getByPlaceholder('搜索错误消息').fill(errorMessage)
    await page.keyboard.press('Enter')

    // 列表中应出现刚上报的错误
    await expect(
      page.locator('.ant-table-row').filter({ hasText: errorMessage }).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('标记错误为已处理 → 状态变更', async ({ page }) => {
    // 先上报一条错误用于标记
    const errorMessage = `e2e-resolve-test-${Date.now()}`
    await fetch('http://localhost:9000/api/v1/error-logs/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'frontend',
        errorType: 'js_error',
        message: errorMessage,
        url: 'http://localhost:3000/error-logs',
      }),
    })

    await page.goto('/error-logs')
    await page.getByPlaceholder('搜索错误消息').fill(errorMessage)
    await page.keyboard.press('Enter')

    const row = page.locator('.ant-table-row').filter({ hasText: errorMessage }).first()
    await expect(row).toBeVisible({ timeout: 10_000 })

    // 点"标记已处理"
    await row.getByRole('button', { name: '标记已处理' }).click()
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
    // L24：锁定行内 Tag 实际从"未处理"翻转为"已处理"（仅断言 toast 时行渲染坏仍会绿）
    await expect(row.getByText('已处理', { exact: true })).toBeVisible({ timeout: 5000 })
  })

  test('白名单 Tab - 新增 + 禁用白名单规则', async ({ page }) => {
    await page.goto('/error-logs')
    await page.getByRole('tab', { name: '白名单规则' }).click()

    const pattern = `e2e-whitelist-${Date.now()}`
    await page.getByRole('button', { name: '新增白名单' }).click()
    await expect(page.getByRole('dialog', { name: '新增白名单' })).toBeVisible()

    await page.locator('.ant-modal').getByLabel('匹配模式').fill(pattern)
    // 匹配类型默认是"消息"，保持不变

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 })

    // 列表中应出现新规则
    await expect(page.locator('.ant-table-row').filter({ hasText: pattern })).toBeVisible({
      timeout: 5000,
    })

    // 禁用刚创建的规则
    const row = page.locator('.ant-table-row').filter({ hasText: pattern })
    await row.getByRole('button', { name: '禁用' }).click()
    await page.locator('.ant-popconfirm .ant-btn-primary').click()

    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 })
    // 软删后行保留（管理员可见已删数据），状态变为已禁用
    await expect(row.getByText('已禁用')).toBeVisible({ timeout: 5000 })
    await expect(row.getByRole('button', { name: '禁用' })).toBeDisabled()
  })

  test('L17：白名单编辑弹窗 + 启用开关 → 行内回显', async ({ page }) => {
    const pattern = `e2e-wl-edit-${Date.now()}`
    await apiClient.post(
      '/error-logs/whitelist',
      { pattern, matchType: 'message', description: '编辑前', isActive: true },
      201,
    )

    await page.goto('/error-logs')
    await page.getByRole('tab', { name: '白名单规则' }).click()

    const row = page.locator('.ant-table-row').filter({ hasText: pattern })
    await expect(row).toBeVisible({ timeout: 10_000 })

    // 编辑说明
    await row.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑白名单' })).toBeVisible()
    const descInput = page.locator('.ant-modal').getByLabel('说明')
    await descInput.clear()
    await descInput.fill('e2e 编辑后说明')
    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText('e2e 编辑后说明', { timeout: 10_000 })

    // 行内启用开关翻转（create 时为 true → 关闭）
    const statusSwitch = row.locator('.ant-switch')
    await expect(statusSwitch).toHaveClass(/ant-switch-checked/)
    await statusSwitch.click()
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 10_000 })
    await expect(statusSwitch).not.toHaveClass(/ant-switch-checked/, { timeout: 10_000 })
  })
})
