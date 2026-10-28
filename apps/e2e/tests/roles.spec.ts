import { adminUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { loginAsAdmin } from '@e2e/helpers/auth'
import { cleanupTempRoles } from '@e2e/helpers/cleanup'
import { expect, test } from '@playwright/test'

/**
 * 角色管理 e2e（admin 视角）
 *
 * 覆盖：
 *   - admin 查看角色列表 → 包含 admin 角色
 *   - admin 新建角色 → 成功
 *   - admin 编辑角色描述 → 成功
 *   - admin 禁用角色（软删）→ 成功
 *   - 普通用户访问 /roles → 403（在 routes.spec.ts 已覆盖，不重复）
 */

const tempRolePrefix = 'e2e-role'

test.beforeAll(async () => {
  await apiClient.login(adminUser.username, adminUser.password)
  // 清理历史残留的 e2e- 角色
  await cleanupTempRoles()
})

test.describe('角色管理（admin 视角）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('查看角色列表 → 包含 admin 角色', async ({ page }) => {
    await page.goto('/roles')
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible()
    // 表格中应该有 admin 角色
    await expect(page.locator('.ant-table-row').filter({ hasText: 'admin' }).first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('新建角色 → 成功', async ({ page }) => {
    await page.goto('/roles')
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible()

    const roleName = `${tempRolePrefix}-${Date.now()}`
    await page.getByRole('button', { name: '新建角色' }).click()
    await expect(page.getByRole('dialog', { name: '新建角色' })).toBeVisible()

    await page.locator('.ant-modal').getByLabel('角色名').fill(roleName)
    await page.locator('.ant-modal').getByLabel('描述').fill('e2e 测试角色')

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()

    // 成功提示
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
    // 列表中应出现新角色
    await expect(page.locator('.ant-table-row').filter({ hasText: roleName })).toBeVisible({
      timeout: 5000,
    })
  })

  test('编辑角色描述 → 成功', async ({ page }) => {
    // 先用 API 创建一个临时角色
    const roleName = `${tempRolePrefix}-edit-${Date.now()}`
    const { data: created } = await apiClient.post<{ id: number }>(
      '/roles',
      { name: roleName, description: '编辑前描述' },
      201,
    )
    expect(created?.id).toBeTruthy()

    await page.goto('/roles')
    // 等待列表加载
    await expect(page.locator('.ant-table-row').filter({ hasText: roleName })).toBeVisible({
      timeout: 10_000,
    })

    // 点编辑
    const targetRow = page.locator('.ant-table-row').filter({ hasText: roleName })
    await targetRow.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑角色' })).toBeVisible()

    // 改描述（角色名可改——roles.service 允许改名并做保留名/冲突校验，此处只覆盖描述路径）
    const descInput = page.locator('.ant-modal').getByLabel('描述')
    await descInput.clear()
    await descInput.fill('e2e 改后的描述')

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()

    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
  })

  test('禁用角色 → 成功', async ({ page }) => {
    // 先用 API 创建一个临时角色
    const roleName = `${tempRolePrefix}-del-${Date.now()}`
    const { data: created } = await apiClient.post<{ id: number }>(
      '/roles',
      { name: roleName, description: '待禁用角色' },
      201,
    )
    expect(created?.id).toBeTruthy()

    await page.goto('/roles')
    await expect(page.locator('.ant-table-row').filter({ hasText: roleName })).toBeVisible({
      timeout: 10_000,
    })

    // 点禁用（Popconfirm）
    const targetRow = page.locator('.ant-table-row').filter({ hasText: roleName })
    await targetRow.getByRole('button', { name: '禁用' }).click()

    // Popconfirm 的确认按钮（okText 未指定，用 CSS class 定位）
    await page.locator('.ant-popconfirm .ant-btn-primary').click()

    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
    // 软删后行保留（管理员可见已删数据），状态变为已禁用
    await expect(targetRow.getByText('已禁用')).toBeVisible({ timeout: 5000 })
    await expect(targetRow.getByRole('button', { name: '禁用' })).toBeDisabled()
  })
})
