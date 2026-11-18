import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodemailerMocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  createTransport: nodemailerMocks.createTransport,
}))

vi.mock('@/config', () => ({
  getEnv: vi.fn(() => ({ APP_NAME: 'Test', ADMIN_ROLE_ID: 1 })),
}))

vi.mock('@/db', () => ({
  db: { select: vi.fn(), query: { users: { findFirst: vi.fn() } } },
}))

vi.mock('@/db/schema', () => ({
  users: { id: {}, email: {} },
}))

const { MailService } = await import('./mail.service')

function makeConfigService() {
  return {
    get: vi.fn((key: string) =>
      key === 'MAIL_HOST'
        ? 'localhost'
        : key === 'MAIL_PORT'
          ? '25'
          : key === 'MAIL_USER'
            ? 'u'
            : key === 'MAIL_PASSWORD'
              ? 'p'
              : undefined,
    ),
  } as never
}

describe('MailService 冷却锁属主（R04）', () => {
  let service: InstanceType<typeof MailService>
  let redisService: { setNx: ReturnType<typeof vi.fn>; eval: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    nodemailerMocks.sendMail.mockResolvedValue(undefined)
    nodemailerMocks.createTransport.mockReturnValue({ sendMail: nodemailerMocks.sendMail })
    redisService = {
      setNx: vi.fn().mockResolvedValue(true),
      eval: vi.fn().mockResolvedValue(1),
    }
    service = new MailService(makeConfigService(), redisService as never)
  })

  it('被限流（setNx=false）→ 抛 ConflictException，不发送', async () => {
    redisService.setNx.mockResolvedValue(false)

    await expect(service.sendWelcome('a@b.com', 'u')).rejects.toThrow(ConflictException)
    expect(nodemailerMocks.sendMail).not.toHaveBeenCalled()
  })

  it('发送失败 → compare-and-delete 仅释放自身租约，不无条件 DEL', async () => {
    redisService.setNx.mockResolvedValue(true)
    nodemailerMocks.sendMail.mockRejectedValue(new Error('smtp down'))

    await expect(service.sendWelcome('a@b.com', 'u')).rejects.toThrow()

    const token = redisService.setNx.mock.calls[0]?.[1] as string
    expect(token).toBeTruthy()
    expect(redisService.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1])"),
      ['mail:limit:a@b.com'],
      [token],
    )
  })

  it('Redis 降级放行（setNx 抛错）→ 发送失败不释放他人租约', async () => {
    redisService.setNx.mockRejectedValue(new Error('redis down'))
    nodemailerMocks.sendMail.mockRejectedValue(new Error('smtp down'))

    await expect(service.sendWelcome('a@b.com', 'u')).rejects.toThrow()

    // 降级未真正持锁，不得进入 compare-and-delete 释放路径（否则会误删后继请求的新锁）
    expect(redisService.eval).not.toHaveBeenCalled()
  })
})
