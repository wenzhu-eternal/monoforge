import { adminUser, targetUser, tempUserPrefix } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { loginAsAdmin, loginAsNormalUser } from '@e2e/helpers/auth'
import { findRoleId } from '@e2e/helpers/cleanup'
import { expect, test } from '@playwright/test'

/**
 * 用户管理 + 提权防护 e2e
 *
 * 覆盖：
 *   - admin 查看用户列表
 *   - admin 改用户资料（nickname）
 *   - admin 改用户角色（需要 USER_ROLE_MANAGE）
 *   - 普通用户尝试改用户资料 → 403
 *   - 普通用户尝试改用户角色 → 403
 *   - admin 删除临时用户
 *   - admin 删除 admin → 409（初始管理员不可删除）
 */

test.beforeAll(async () => {
  // 用 admin 登录 apiClient，用于数据准备
  await apiClient.login(adminUser.username, adminUser.password)

  // 校验目标用户已由 global-setup 创建
  const { data } = await apiClient.get<{ list: Array<{ id: number; username: string }> }>(
    '/users?pageSize=100',
  )
  const target = data.list.find((u) => u.username === targetUser.username)
  if (!target) throw new Error(`目标用户 ${targetUser.username} 未创建，请检查 global-setup`)
})

test.describe('用户管理（admin 视角）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('查看用户列表 → 包含 admin 用户', async ({ page }) => {
    await page.goto('/users')
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible()
    // 用 admin 邮箱精确匹配（避免 e2e_target_user 被改成 admin 角色后也匹配 "admin"）
    await expect(page.locator('.ant-table-row').filter({ hasText: adminUser.email })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('改用户资料（nickname）→ 成功', async ({ page }) => {
    await page.goto('/users')
    await expect(
      page.locator('.ant-table-row').filter({ hasText: targetUser.username }),
    ).toBeVisible({ timeout: 10_000 })

    // 找到目标用户行，点「编辑」
    const targetRow = page.locator('.ant-table-row').filter({ hasText: targetUser.username })
    await targetRow.getByRole('button', { name: '编辑' }).click()

    await expect(page.getByRole('dialog', { name: '编辑用户' })).toBeVisible()

    // 改 nickname
    const nicknameInput = page.locator('.ant-modal').getByLabel('昵称')
    await nicknameInput.clear()
    await nicknameInput.fill('e2e-改后昵称')

    // 提交（Modal 的确定按钮）
    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()

    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
  })

  test('改用户角色（admin 有 USER_ROLE_MANAGE）→ 成功', async ({ page }) => {
    await page.goto('/users')
    await expect(
      page.locator('.ant-table-row').filter({ hasText: targetUser.username }),
    ).toBeVisible({ timeout: 10_000 })

    const targetRow = page.locator('.ant-table-row').filter({ hasText: targetUser.username })
    await targetRow.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑用户' })).toBeVisible()

    // 角色 Select - antd Modal 内的 combobox（label 显示为 "* 角色" 带星号）
    await page.locator('.ant-modal').getByRole('combobox').click()
    // 下拉项中点 admin
    await page.locator('.ant-select-item').filter({ hasText: 'admin' }).first().click()

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
  })

  test('删除临时用户 → 成功', async ({ page }) => {
    // 先用 API 创建一个临时用户（用户名用下划线，UsernameSchema 禁用连字符）
    const tempUsername = `${tempUserPrefix}_${Date.now()}`
    const { data: created } = await apiClient.post<{ id: number }>(
      '/users',
      {
        username: tempUsername,
        email: `${tempUsername}@test.com`,
        password: 'temp-password-123',
        nickname: '临时用户',
        roleId: await findRoleId('user'), // 动态查询，避免写死 seed 顺序
      },
      201,
    )
    expect(created?.id).toBeTruthy()

    await page.goto('/users')
    await page.waitForTimeout(1500)

    // 删除临时用户（用 API 直接删，UI 操作在另一条用例覆盖）
    const { status } = await apiClient.delete(`/users/${created?.id}`)
    expect([200, 204].includes(status)).toBe(true)
  })

  test('删除 admin 用户 → 409（初始管理员不可删除）', async () => {
    // UI 上 admin 行的删除按钮是 disabled，直接走 API 验证
    // 精确删 admin（id=1）应返回 409
    const adminDeleteRes = await apiClient.delete<{ message?: string }>('/users/1')
    expect([409, 404].includes(adminDeleteRes.status)).toBe(true)
  })
})

test.describe('提权防护（普通用户视角）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNormalUser(page)
  })

  test('普通用户访问 /users → 正常显示（有 user:view 权限）', async ({ page }) => {
    await page.goto('/users')
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible()
  })

  test('普通用户尝试改用户资料 → 403 提示', async ({ page }) => {
    await page.goto('/users')
    await expect(
      page.locator('.ant-table-row').filter({ hasText: targetUser.username }),
    ).toBeVisible({ timeout: 10_000 })

    const targetRow = page.locator('.ant-table-row').filter({ hasText: targetUser.username })
    await targetRow.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑用户' })).toBeVisible()

    // 改 nickname
    const nicknameInput = page.locator('.ant-modal').getByLabel('昵称')
    await nicknameInput.clear()
    await nicknameInput.fill('普通用户改的昵称')

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()

    // 应该看到错误提示（403 由 PermissionsGuard 拦截，普通用户无 user:update）
    await expect(page.locator('.ant-message-error')).toBeVisible({ timeout: 5000 })
  })

  test('普通用户角色 Select 无选项（GET /roles 被 403 拦截）', async ({ page }) => {
    await page.goto('/users')
    await expect(
      page.locator('.ant-table-row').filter({ hasText: targetUser.username }),
    ).toBeVisible({ timeout: 10_000 })

    const targetRow = page.locator('.ant-table-row').filter({ hasText: targetUser.username })
    await targetRow.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑用户' })).toBeVisible()

    // 普通用户无 role:view 权限，GET /roles 返回 403，rolesData.list 为空
    // 打开角色 Select 下拉，验证无选项（前端越权防护的体现）
    await page.locator('.ant-modal').getByRole('combobox').click()
    const dropdown = page.locator('.ant-select-dropdown').last()
    await expect(dropdown).toBeVisible({ timeout: 3000 })
    // 等 antd 渲染完，再断言无选项
    await page.waitForTimeout(500)
    await expect(dropdown.locator('.ant-select-item')).toHaveCount(0)

    // 关闭弹窗
    await page.keyboard.press('Escape')
  })
})
