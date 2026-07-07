import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MailController } from './mail.controller'
import type { MailService } from './mail.service'

describe('MailController', () => {
  let controller: MailController
  let service: MailService

  beforeEach(() => {
    service = {
      isConfigured: vi.fn().mockReturnValue(true),
      sendWelcome: vi.fn(),
      sendVerificationCode: vi.fn(),
    } as unknown as MailService

    controller = new MailController(service)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('sendWelcome', () => {
    it('发送欢迎邮件成功', async () => {
      const dto = { to: 'user@test.com', username: '文竹' }

      const result = await controller.sendWelcome(dto)

      expect(result).toEqual({ message: '欢迎邮件已发送至 user@test.com' })
      expect(service.sendWelcome).toHaveBeenCalledWith('user@test.com', '文竹')
    })

    it('邮件服务未配置时抛 BadRequestException', async () => {
      vi.mocked(service.isConfigured).mockReturnValue(false)

      await expect(controller.sendWelcome({ to: 'a@b.com', username: 'x' })).rejects.toThrow(
        BadRequestException,
      )
      expect(service.sendWelcome).not.toHaveBeenCalled()
    })
  })

  describe('sendVerificationCode', () => {
    it('发送验证码邮件成功', async () => {
      const dto = { to: 'user@test.com', name: '文竹' }

      const result = await controller.sendVerificationCode(dto)

      expect(result).toEqual({ message: '验证码邮件已发送至 user@test.com' })
      expect(service.sendVerificationCode).toHaveBeenCalledWith('user@test.com', '文竹')
    })

    it('未传 name 时使用 undefined', async () => {
      const dto = { to: 'user@test.com' }

      await controller.sendVerificationCode(dto)

      expect(service.sendVerificationCode).toHaveBeenCalledWith('user@test.com', undefined)
    })

    it('邮件服务未配置时抛 BadRequestException', async () => {
      vi.mocked(service.isConfigured).mockReturnValue(false)

      await expect(controller.sendVerificationCode({ to: 'a@b.com' })).rejects.toThrow(
        BadRequestException,
      )
      expect(service.sendVerificationCode).not.toHaveBeenCalled()
    })
  })
})
