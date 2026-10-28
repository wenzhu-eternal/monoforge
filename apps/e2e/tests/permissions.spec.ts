import { adminUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { loginAsAdmin } from '@e2e/helpers/auth'
import { cleanupTempPermissions } from '@e2e/helpers/cleanup'
import { expect, test } from '@playwright/test'

/**
 * 权限管理 e2e（admin 视角）
 *
 * 覆盖：
 *   - 查看权限列表
 *   - 新建权限 → 成功
 *   - 编辑权限描述 → 成功
 *   - 配置权限路由 → 成功
 *   - 禁用权限（软删）→ 成功
 */

const tempPermPrefix = 'e2e_perm'

test.beforeAll(async () => {
  await apiClient.login(adminUser.username, adminUser.password)
  await cleanupTempPermissions()
})

test.describe('权限管理（admin 视角）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('查看权限列表 → 有数据', async ({ page }) => {
    await page.goto('/permissions')
    await expect(page.getByRole('heading', { name: '权限管理' })).toBeVisible()
    // 表格应有数据（seed 会创建一批权限）
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10_000 })
  })

  test('新建权限 → 成功', async ({ page }) => {
    await page.goto('/permissions')

    const permCode = `${tempPermPrefix}_${Date.now()}`
    await page.getByRole('button', { name: '新建权限' }).click()
    await expect(page.getByRole('dialog', { name: '新建权限' })).toBeVisible()

    await page.locator('.ant-modal').getByLabel('权限码').fill(permCode)
    await page.locator('.ant-modal').getByLabel('权限名').fill('e2e 测试权限')
    await page.locator('.ant-modal').getByLabel('描述').fill('e2e 自动创建的测试权限')

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()

    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
    // 列表中应出现新权限
    await expect(page.locator('.ant-table-row').filter({ hasText: permCode })).toBeVisible({
      timeout: 5000,
    })
  })

  test('编辑权限描述 → 成功', async ({ page }) => {
    // 先用 API 创建一个临时权限
    const permCode = `${tempPermPrefix}_edit_${Date.now()}`
    const { data: created } = await apiClient.post<{ id: number }>(
      '/permissions',
      { code: permCode, name: 'e2e 编辑测试', description: '编辑前' },
      201,
    )
    expect(created?.id).toBeTruthy()

    await page.goto('/permissions')
    await expect(page.locator('.ant-table-row').filter({ hasText: permCode })).toBeVisible({
      timeout: 10_000,
    })

    const row = page.locator('.ant-table-row').filter({ hasText: permCode })
    await row.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑权限' })).toBeVisible()

    const descInput = page.locator('.ant-modal').getByLabel('描述')
    await descInput.clear()
    await descInput.fill('e2e 改后的描述')

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()

    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
    // L16：锁定行内描述已更新，避免只有 toast 的假绿
    await expect(row).toContainText('e2e 改后的描述', { timeout: 10_000 })
  })

  test('配置权限路由 → 成功', async ({ page }) => {
    // 先用 API 创建一个临时权限
    const permCode = `${tempPermPrefix}_route_${Date.now()}`
    const { data: created } = await apiClient.post<{ id: number }>(
      '/permissions',
      { code: permCode, name: 'e2e 路由配置测试', description: '测试配置路由' },
      201,
    )
    expect(created?.id).toBeTruthy()

    await page.goto('/permissions')
    await expect(page.locator('.ant-table-row').filter({ hasText: permCode })).toBeVisible({
      timeout: 10_000,
    })

    const row = page.locator('.ant-table-row').filter({ hasText: permCode })
    await row.getByRole('button', { name: '配置路由' }).click()

    // 配置路由 Modal
    await expect(page.getByRole('dialog', { name: '配置路由' })).toBeVisible({ timeout: 5000 })

    // 勾选第一个 checkbox（如果有的话）
    const firstCheckbox = page.locator('.ant-modal .ant-checkbox-wrapper').first()
    const checkboxCount = await page.locator('.ant-modal .ant-checkbox-wrapper').count()
    if (checkboxCount > 0) {
      await firstCheckbox.click()
    }

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })

    // L16：重新打开弹窗确认勾选已持久化（原仅 toast，路由未保存也过）
    if (checkboxCount > 0) {
      await row.getByRole('button', { name: '配置路由' }).click()
      await expect(page.getByRole('dialog', { name: '配置路由' })).toBeVisible({ timeout: 5000 })
      await expect(
        page.locator('.ant-modal .ant-checkbox-wrapper').first().locator('input'),
      ).toBeChecked()
      await page.locator('.ant-modal-footer').getByRole('button', { name: '取 消' }).click()
    }
  })

  test('禁用权限 → 成功', async ({ page }) => {
    // 先用 API 创建一个临时权限
    const permCode = `${tempPermPrefix}_del_${Date.now()}`
    const { data: created } = await apiClient.post<{ id: number }>(
      '/permissions',
      { code: permCode, name: 'e2e 禁用测试', description: '待禁用' },
      201,
    )
    expect(created?.id).toBeTruthy()

    await page.goto('/permissions')
    await expect(page.locator('.ant-table-row').filter({ hasText: permCode })).toBeVisible({
      timeout: 10_000,
    })

    const row = page.locator('.ant-table-row').filter({ hasText: permCode })
    await row.getByRole('button', { name: '禁用' }).click()

    await page.locator('.ant-popconfirm .ant-btn-primary').click()

    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
    // 软删后行保留（管理员可见已删数据），状态变为已禁用
    await expect(row.getByText('已禁用')).toBeVisible({ timeout: 5000 })
    await expect(row.getByRole('button', { name: '禁用' })).toBeDisabled()
  })
})
