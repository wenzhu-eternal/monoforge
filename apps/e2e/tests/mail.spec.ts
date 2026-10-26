import { adminUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { loginAsAdmin } from '@e2e/helpers/auth'
import { expect, test } from '@playwright/test'

/**
 * 邮件发送 e2e（admin 视角）
 *
 * 覆盖：
 *   - 页面正常渲染 + 邮件类型切换
 *   - 欢迎邮件表单提交（未配置 SMTP 时应返回 400 错误提示）
 *   - 验证码邮件表单提交（未配置 SMTP 时应返回 400 错误提示）
 *   - 表单校验（空邮箱、非法邮箱）
 *
 * 注意：dev 环境通常未配置 MAIL_HOST，后端会返回 400 "邮件服务未配置"
 */

// 每个用例用不同收件人，避免 MailService 同一邮箱 60s 限频把后续断言变成 409
const mailRecipient = (prefix: string) => `e2e-${prefix}-${Date.now()}@example.com`

test.beforeAll(async () => {
  await apiClient.login(adminUser.username, adminUser.password)
})

test.describe('邮件发送（admin 视角）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('页面渲染 + 切换邮件类型', async ({ page }) => {
    await page.goto('/mail')
    await expect(page.getByRole('heading', { name: '邮件发送' })).toBeVisible()

    // 默认显示"欢迎邮件"表单
    await expect(page.getByText('发送欢迎邮件')).toBeVisible()

    // 切换到验证码邮件（Radio.Button 的 input 不可见，点 label/span）
    await page.getByText('验证码邮件', { exact: true }).click()
    await expect(page.getByText('发送验证码邮件')).toBeVisible()

    // 切换回欢迎邮件
    await page.getByText('欢迎邮件', { exact: true }).click()
    await expect(page.getByText('发送欢迎邮件')).toBeVisible()
  })

  test('欢迎邮件表单校验 - 非法邮箱', async ({ page }) => {
    await page.goto('/mail')

    // 填写非法邮箱
    await page.getByLabel('收件人邮箱').fill('invalid-email')
    await page.getByLabel('用户名').fill('testuser')
    await page.getByRole('button', { name: '发送欢迎邮件' }).click()

    // 应显示表单校验错误（当前复用 shared UserEmailSchema 的 zod 默认英文文案）
    await expect(page.locator('.ant-form-item-explain-error').first()).toHaveText(
      /Invalid email address|邮箱格式不正确/,
      { timeout: 3000 },
    )
  })

  test('欢迎邮件表单校验 - 必填项', async ({ page }) => {
    await page.goto('/mail')

    // 直接点提交，不填任何字段
    await page.getByRole('button', { name: '发送欢迎邮件' }).click()

    // 应显示必填校验错误
    await expect(page.getByText('请输入邮箱')).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('请输入用户名')).toBeVisible({ timeout: 3000 })
  })

  test('发送欢迎邮件 - 后端响应验证', async ({ page }) => {
    const recipient = mailRecipient('welcome')
    // 先用 API 验证后端响应（避免 UI 等待 SMTP 超时）
    const { status } = await apiClient.post('/mail/welcome', {
      to: recipient,
      username: 'e2e-test-user',
    })
    // L18：只接受两种确定态——已配置 SMTP 200 / 未配置 400；
    // 429/409 是测试自身污染（限频），500 是 SMTP 拒绝（环境故障），均不得静默通过
    expect(status === 200 || status === 400).toBe(true)

    // UI 用不同收件人，避免撞上上一步触发的 60s 同收件人限频
    const uiRecipient = mailRecipient('welcome-ui')
    await page.goto('/mail')
    await page.getByLabel('收件人邮箱').fill(uiRecipient)
    await page.getByLabel('用户名').fill('e2e-test-user')
    await page.getByRole('button', { name: '发送欢迎邮件' }).click()
    // L18：按后端确定态固定期望——未配置必须提示"未配置"，已配置必须成功，
    // 不再用"成功或失败二选一"的弱断言
    if (status === 400) {
      await expect(page.locator('.ant-message-error').first()).toContainText('邮件服务未配置', {
        timeout: 30_000,
      })
    } else {
      await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 30_000 })
    }
  })

  test('发送验证码邮件 - 后端响应验证', async ({ page }) => {
    const recipient = mailRecipient('verification')
    const { status } = await apiClient.post('/mail/verification-code', {
      to: recipient,
      name: 'e2e 测试',
    })
    // L18：同欢迎邮件，只接受 200（已配置）/ 400（未配置）两种确定态
    expect(status === 200 || status === 400).toBe(true)

    const uiRecipient = mailRecipient('verification-ui')
    await page.goto('/mail')
    await page.getByText('验证码邮件', { exact: true }).click()
    await page.getByLabel('收件人邮箱').fill(uiRecipient)
    await page.getByRole('button', { name: '发送验证码邮件' }).click()
    if (status === 400) {
      await expect(page.locator('.ant-message-error').first()).toContainText('邮件服务未配置', {
        timeout: 30_000,
      })
    } else {
      await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 30_000 })
    }
  })
})
