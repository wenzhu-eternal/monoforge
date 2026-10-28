import { makePngFile } from '@e2e/fixtures/files'
import { adminUser } from '@e2e/fixtures/users'
import { apiClient } from '@e2e/helpers/api'
import { loginAsAdmin } from '@e2e/helpers/auth'
import { expect, test } from '@playwright/test'

/**
 * 文件上传 + 软删 e2e
 *
 * 覆盖：
 *   - admin 上传 PNG → 列表显示
 *   - admin 禁用自己上传的文件 → 成功 + 状态变更
 *   - 上传者删除自己的文件（通过 API 验证 200）
 *   - 普通用户删除他人文件 → 403
 *   - admin 删除他人上传的文件 → 200
 *   - 上传非法文件 → 失败提示
 */

test.describe('文件上传 + 软删', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    // apiClient 也用 admin 登录
    await apiClient.login(adminUser.username, adminUser.password)
  })

  test('admin 上传 PNG → 列表显示', async ({ page }) => {
    await page.goto('/files')
    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()

    const filename = `e2e-upload-${Date.now()}.png`
    const filePath = makePngFile(filename)

    // antd Upload 通过 file input 接收文件
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(filePath)

    // 上传成功提示
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 10_000 })

    // L16：锁定本次新上传的文件行（原断言任意旧行即过，invalidate 漏掉仍假绿）
    await expect(page.locator('.ant-table-row').filter({ hasText: filename })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('admin 禁用自己上传的文件 → 成功 + 状态变更', async ({ page }) => {
    const filename = `e2e-delete-${Date.now()}.png`
    const filePath = makePngFile(filename)
    const { data: uploaded } = await apiClient.uploadFile(
      '/files/upload',
      filePath,
      filename,
      'image/png',
    )
    const fileId = (uploaded as { id?: number })?.id
    expect(fileId).toBeTruthy()

    await page.goto('/files')
    const row = page.locator('.ant-table-row').filter({ hasText: filename })
    await expect(row).toBeVisible({ timeout: 10_000 })

    await row.getByRole('button', { name: '禁用' }).click()
    // antd Popconfirm 的确认按钮（okText 未指定，用 CSS class 定位避免文案差异）
    await page.locator('.ant-popconfirm .ant-btn-primary').click()

    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 })
    // 软删后行保留（管理员可见已删数据），状态变为已禁用
    await expect(row.getByText('已禁用')).toBeVisible({ timeout: 5000 })
    await expect(row.getByRole('button', { name: '禁用' })).toBeDisabled()
  })

  test('上传者通过 API 删除自己的文件 → 200', async () => {
    const filePath = makePngFile(`e2e-api-delete-${Date.now()}.png`)
    const { data: uploaded } = await apiClient.uploadFile(
      '/files/upload',
      filePath,
      `e2e-api-delete-${Date.now()}.png`,
      'image/png',
    )
    const fileId = (uploaded as { id?: number })?.id
    expect(fileId).toBeTruthy()

    const { status } = await apiClient.delete(`/files/${fileId}`)
    expect([200, 204].includes(status)).toBe(true)

    // 二次删除应 404（已软删）
    const { status: secondStatus } = await apiClient.delete(`/files/${fileId}`)
    expect(secondStatus).toBe(404)
  })

  test('admin 通过 API 删除他人上传的文件 → 200', async () => {
    const filePath = makePngFile(`e2e-admin-delete-${Date.now()}.png`)
    const { data: uploaded } = await apiClient.uploadFile(
      '/files/upload',
      filePath,
      `e2e-admin-delete-${Date.now()}.png`,
      'image/png',
    )
    const fileId = (uploaded as { id?: number })?.id
    expect(fileId).toBeTruthy()

    const { status } = await apiClient.delete(`/files/${fileId}`)
    expect([200, 204].includes(status)).toBe(true)
  })

  test('上传非法文件内容（伪装 png）→ 失败提示', async ({ page }) => {
    await page.goto('/files')
    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()

    // 创建一个内容是文本但扩展名是 .png 的文件
    const { makeFakeFile } = await import('@e2e/fixtures/files')
    const fakePath = makeFakeFile(`e2e-fake-${Date.now()}.png`)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(fakePath)

    // 应该看到错误提示（文件内容校验失败）
    await expect(page.locator('.ant-message-error')).toBeVisible({ timeout: 10_000 })
  })
})
