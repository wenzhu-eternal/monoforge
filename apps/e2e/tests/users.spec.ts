import { adminUser, normalUser, targetUser, tempUserPrefix } from '@e2e/fixtures/users'
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
 *   - 普通用户访问 /users → 403（无 user:view，J2=A 测试口径与 routes.spec 统一）
 *   - 普通用户尝试改用户资料 → API 层 403（越权断言走 API，页面级只验路由守卫）
 *   - 普通用户角色 Select → API 层 GET /roles 403（无 role:view）
 *   - admin 删除临时用户
 *   - admin 删除 admin → 409（初始管理员不可删除）
 */

let targetUserId: number
let adminUserId: number
let adminEmail: string

test.beforeAll(async () => {
  // 用 admin 登录 apiClient，用于数据准备
  const loginRes = await apiClient.login(adminUser.username, adminUser.password)
  // 邮箱受 SEED_ADMIN_EMAIL 影响，不能从夹具硬编码
  adminUserId = loginRes.user.id
  adminEmail = loginRes.user.email

  // 校验目标用户已由 global-setup 创建，并缓存其 id 供越权用例直接引用
  //（M11：普通用户无 USER_VIEW，列表接口 403 返回 data:null，用例内再查列表必 TypeError）
  const { data } = await apiClient.get<{ list: Array<{ id: number; username: string }> }>(
    '/users?pageSize=100',
  )
  const target = data.list.find((u) => u.username === targetUser.username)
  if (!target) throw new Error(`目标用户 ${targetUser.username} 未创建，请检查 global-setup`)
  targetUserId = target.id
})

test.describe('用户管理（admin 视角）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('查看用户列表 → 包含 admin 用户', async ({ page }) => {
    await page.goto('/users')
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible()
    // 用登录响应里的真实邮箱精确匹配（避免 e2e_target_user 被改成 admin 角色后也匹配 "admin"）
    await expect(page.locator('.ant-table-row').filter({ hasText: adminEmail })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('M2：admin 编辑自己只改昵称 → 成功（不再被"不能修改自己的角色"403 打回）', async ({
    page,
  }) => {
    await page.goto('/users')
    const ownRow = page.locator('.ant-table-row').filter({ hasText: adminEmail })
    await expect(ownRow).toBeVisible({ timeout: 10_000 })

    await ownRow.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑用户' })).toBeVisible()

    const nicknameInput = page.locator('.ant-modal').getByLabel('昵称')
    await nicknameInput.clear()
    await nicknameInput.fill('e2e-admin昵称')

    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click()

    // 修复前此处必出 `.ant-message-error`（403 不能修改自己的角色）
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.ant-message-error')).toHaveCount(0)
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
    // L18：原 waitForTimeout(1500) 是无断言的死等——改为锁定新用户已渲染，
    // 既验证页面数据确实刷新，又避免固定延时在慢机上失效。
    // exact: 必填——用户名同时出现在邮箱 cell（name@test.com）里，模糊匹配会 strict 双命中
    await expect(page.getByRole('cell', { name: tempUsername, exact: true })).toBeVisible({
      timeout: 10_000,
    })

    // 删除临时用户（用 API 直接删，UI 操作在另一条用例覆盖）
    const { status } = await apiClient.delete(`/users/${created?.id}`)
    expect([200, 204].includes(status)).toBe(true)
  })

  test('删除 admin 用户 → 409（初始管理员不可删除）', async () => {
    // UI 上 admin 行的删除按钮是 disabled，直接走 API 验证
    // 用登录响应里的真实 id，避免 seed 自增 id 漂移
    const adminDeleteRes = await apiClient.delete<{ message?: string }>(`/users/${adminUserId}`)
    expect(adminDeleteRes.status).toBe(409)
  })
})

test.describe('提权防护（普通用户视角，J2=A：零权限预期 403 路由）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNormalUser(page)
  })

  // M5/J2=A：普通用户无 USER_VIEW，布局层 ROUTE_PERMISSION_MAP 门控 → /403
  test('普通用户访问 /users → 跳转 /403（无 user:view 权限）', async ({ page }) => {
    await page.goto('/users')
    await expect(page).toHaveURL(/\/403$/)
  })

  // 越权操作断言走 API 层（页面级只验路由守卫）
  test('普通用户尝试改用户资料 → API 层 403（无 user:update）', async () => {
    await apiClient.login(normalUser.username, normalUser.password)

    // M11：targetId 由 beforeAll 段 admin 缓存——普通用户无 USER_VIEW，
    // 列表接口 403 返回 data:null，用例内查列表必 TypeError（CI 全新库必红）
    const res = await apiClient.patch(`/users/${targetUserId}`, {
      nickname: '越权改的昵称',
    })
    expect(res.status).toBe(403)
  })

  // 越权操作断言走 API 层
  test('普通用户 GET /roles → 403（无 role:view，角色 Select 无数据来源）', async () => {
    await apiClient.login(normalUser.username, normalUser.password)
    const res = await apiClient.get('/roles')
    expect(res.status).toBe(403)
  })
})
