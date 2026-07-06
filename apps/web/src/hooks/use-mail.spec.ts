import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

import { renderHookWithQuery } from '@/test/utils'
import { useSendVerificationCodeMail, useSendWelcomeMail } from './use-mail'

describe('use-mail hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useSendWelcomeMail', () => {
    it('发送欢迎邮件成功', async () => {
      apiMock.post.mockResolvedValue({
        data: { code: 200, data: { message: '欢迎邮件已发送至 a@b.com' } },
      })

      const { result } = renderHookWithQuery(() => useSendWelcomeMail())

      const res = await result.current.mutateAsync({ to: 'a@b.com', username: '文竹' })

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/mail/welcome', {
        to: 'a@b.com',
        username: '文竹',
      })
      expect(res.message).toContain('欢迎邮件')
    })

    it('发送失败时进入 error 状态', async () => {
      apiMock.post.mockRejectedValue(new Error('邮件服务未配置'))

      const { result } = renderHookWithQuery(() => useSendWelcomeMail())

      await expect(result.current.mutateAsync({ to: 'a@b.com', username: 'x' })).rejects.toThrow(
        '邮件服务未配置',
      )
    })
  })

  describe('useSendVerificationCodeMail', () => {
    it('发送验证码邮件（带 name）', async () => {
      apiMock.post.mockResolvedValue({
        data: { code: 200, data: { message: '验证码邮件已发送至 a@b.com' } },
      })

      const { result } = renderHookWithQuery(() => useSendVerificationCodeMail())

      const res = await result.current.mutateAsync({ to: 'a@b.com', code: '123456', name: '文竹' })

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/mail/verification-code', {
        to: 'a@b.com',
        code: '123456',
        name: '文竹',
      })
      expect(res.message).toContain('验证码')
    })

    it('发送验证码邮件（不带 name）', async () => {
      apiMock.post.mockResolvedValue({
        data: { code: 200, data: { message: 'ok' } },
      })

      const { result } = renderHookWithQuery(() => useSendVerificationCodeMail())

      await result.current.mutateAsync({ to: 'a@b.com', code: '123456' })

      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/mail/verification-code', {
        to: 'a@b.com',
        code: '123456',
      })
    })
  })
})
