import { adminUser, normalUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { loginAsAdmin, loginAsNormalUser } from '@e2e/helpers/auth'
import { fetchAllPages } from '@e2e/helpers/cleanup'
import { expect, test } from '@playwright/test'

/**
 * WebSocket 通知 e2e
 *
 * 覆盖：
 *   - admin 给自己发通知 → 成功 + 实时收到
 *   - 普通用户访问 /websocket → 403（无 NOTIFICATION_VIEW，J2=A）
 *   - 离线用户通知 → 持久化（通过 API 验证）
 */

let adminUserId: number
let normalUserId: number

test.beforeAll(async () => {
  await apiClient.login(adminUser.username, adminUser.password)
  // M5：软删不清理 + 每轮新增账号会逐轮把夹具挤出单页首屏——逐页拉全量
  const users = await fetchAllPages<{ id: number; username: string }>('/users')
  adminUserId = users.find((u) => u.username === adminUser.username)?.id ?? 1
  normalUserId = users.find((u) => u.username === normalUser.username)?.id ?? 0
  if (!normalUserId) throw new Error('普通用户未创建，请检查 global-setup')
})

test.describe('WebSocket 通知', () => {
  test('admin 给自己发通知 → 成功 + 实时收到', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/websocket')
    await expect(page.getByRole('heading', { name: 'WebSocket 演示' })).toBeVisible()

    // 等待 WebSocket 连接建立
    await expect(page.locator('.ant-badge-status-success').first()).toBeVisible({
      timeout: 10_000,
    })

    // 目标用户已锁定为当前用户（disabled），直接校验默认值，不再尝试清空/填写
    const userIdInput = page.getByRole('spinbutton')
    await expect(userIdInput).toHaveValue(String(adminUserId))
    await expect(userIdInput).toBeDisabled()

    const title = `e2e 自测通知 ${Date.now()}`
    await page.getByPlaceholder('如：系统测试通知').fill(title)
    await page.getByPlaceholder('通知内容').fill('e2e 测试内容')

    await page.getByRole('button', { name: '发送通知' }).click()

    // 成功提示
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })

    // 实时通知列表应显示（标题带时间戳，避免命中上一轮残留通知）
    await expect(page.getByText(title)).toBeVisible({ timeout: 5000 })
  })

  // M5/J2=A：普通用户无 NOTIFICATION_VIEW，布局层门控 → /403，无 WebSocket 连接
  test('普通用户访问 /websocket → 跳转 /403（无 NOTIFICATION_VIEW）', async ({ page }) => {
    await loginAsNormalUser(page)
    await page.goto('/websocket')
    await expect(page).toHaveURL(/\/403$/)
  })

  test('离线用户通知 → 持久化（通过 API 验证）', async () => {
    // normalUser 未建立 WebSocket 连接（离线），用 normalUser 自己的 token 给自己发通知
    // controller 限制只能给自己发（dto.userId === user.sub），给他人发会 403
    // 验证返回 delivered=false（持久化但未实时推送）
    await apiClient.login(normalUser.username, normalUser.password)

    const { status, data } = await apiClient.post<{ delivered?: boolean; id?: number }>(
      '/websocket/notify',
      {
        userId: normalUserId,
        type: 'e2e-offline-test',
        title: 'e2e 离线持久化通知',
        content: 'e2e 验证离线用户通知持久化',
      },
    )

    // controller 用 @HttpCode(200)，应返回 200
    expect([200, 201].includes(status)).toBe(true)
    // 离线用户 delivered 应为 false
    expect(data?.delivered).toBe(false)
  })
})
