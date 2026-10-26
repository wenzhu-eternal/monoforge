import { ConflictException, ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
      roles: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
  isUniqueViolation: vi.fn(() => false),
}))

vi.mock('@/config/env', () => ({
  getEnv: vi.fn(() => ({ DEFAULT_USER_ROLE_ID: 2 })),
}))

const { db: mockDb } = await import('@/db')

import { WechatService } from './wechat.service'

describe('WechatService', () => {
  // 构造一组 mock 依赖，enabled 控制是否配置了 appid+secret
  function buildService(enabled: boolean) {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'WEAPP_APPID') return enabled ? 'wx-appid' : undefined
        if (key === 'WEAPP_SECRET') return enabled ? 'wx-secret' : undefined
        if (key === 'WECHAT_REDIRECT_URI') return 'https://example.com/callback'
        return undefined
      }),
    }
    const httpClient = {
      createInstance: vi.fn().mockReturnValue({} as never),
      get: vi.fn(),
      post: vi.fn(),
    }
    const redisService = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(undefined),
    }
    const authService = {
      signTokenPair: vi.fn(),
      storeRefreshTokenForExternal: vi.fn().mockResolvedValue(undefined),
    }
    const service = new WechatService(
      configService as never,
      httpClient as never,
      redisService as never,
      authService as never,
    )
    return { service, configService, httpClient, redisService, authService }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isEnabled', () => {
    it('配置了 appid 和 secret 时返回 true', () => {
      const { service } = buildService(true)
      expect(service.isEnabled()).toBe(true)
    })

    it('未配置 appid 或 secret 时返回 false', () => {
      const { service } = buildService(false)
      expect(service.isEnabled()).toBe(false)
    })
  })

  describe('getQrCode', () => {
    it('未启用时抛 ServiceUnavailableException', async () => {
      const { service } = buildService(false)

      await expect(service.getQrCode()).rejects.toThrow(ServiceUnavailableException)
    })

    it('启用时返回二维码 URL、state 与过期时间', async () => {
      const { service, redisService, configService } = buildService(true)

      const result = await service.getQrCode()

      expect(result.state).toEqual(expect.any(String))
      expect(result.expiresIn).toBe(300)
      expect(result.qrCodeUrl).toContain('open.weixin.qq.com/connect/qrconnect')
      expect(result.qrCodeUrl).toContain('appid=wx-appid')
      expect(result.qrCodeUrl).toContain('state=')
      // state 已写入 Redis
      expect(redisService.set).toHaveBeenCalledWith(`wechat:state:${result.state}`, '1', 300)
      // 读取了 redirect URI
      expect(configService.get).toHaveBeenCalledWith('WECHAT_REDIRECT_URI')
    })
  })

  describe('login - requireEnabled 防护', () => {
    it('未启用时 login 抛 ServiceUnavailableException', async () => {
      const { service } = buildService(false)

      await expect(service.login('some-code', 'qrcode')).rejects.toThrow(
        ServiceUnavailableException,
      )
    })

    it('未启用时 login 抛 ServiceUnavailableException（miniprogram 类型）', async () => {
      const { service } = buildService(false)

      await expect(service.login('some-code', 'miniprogram')).rejects.toThrow(
        ServiceUnavailableException,
      )
    })
  })

  describe('login - 默认角色缺失', () => {
    it('L8：默认 user 角色不存在时抛 409，且不落库', async () => {
      const { service, httpClient } = buildService(true)
      vi.mocked(httpClient.get).mockResolvedValue({
        openid: 'openid-1',
        session_key: 'session-key',
      } as never)
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue(undefined)
      vi.mocked(mockDb.query.roles.findFirst).mockResolvedValue(undefined)

      await expect(service.login('some-code', 'miniprogram')).rejects.toThrow(ConflictException)
      expect(mockDb.insert).not.toHaveBeenCalled()
    })
  })

  describe('login - M2 强制改密签发面', () => {
    it('已绑定微信且需强制改密时，payload 携带 mustChangePassword=true', async () => {
      const { service, httpClient, authService } = buildService(true)
      vi.mocked(httpClient.get).mockResolvedValue({
        openid: 'openid-1',
        session_key: 'session-key',
      } as never)
      vi.mocked(mockDb.query.users.findFirst).mockResolvedValue({
        id: 9,
        username: 'wx_openid-1',
        email: 'wx_openid-1@wechat.placeholder',
        roleId: 2,
        nickname: null,
        avatar: null,
        deletedAt: null,
        status: true,
        mustChangePassword: true,
      } as never)
      authService.signTokenPair.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' })

      await service.login('some-code', 'miniprogram')

      expect(authService.signTokenPair).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 9, mustChangePassword: true }),
      )
    })
  })

  describe('构造函数', () => {
    it('构造时创建两个 axios 实例（扫码 + 小程序）', () => {
      const { httpClient } = buildService(true)

      expect(httpClient.createInstance).toHaveBeenCalledTimes(2)
      // 两次都指定了 api.weixin.qq.com 作为 baseURL
      const calls = vi.mocked(httpClient.createInstance).mock.calls
      expect(calls[0][0]).toMatchObject({
        baseURL: 'https://api.weixin.qq.com',
        timeout: 10000,
        maxRetries: 2,
      })
      expect(calls[1][0]).toMatchObject({
        baseURL: 'https://api.weixin.qq.com',
      })
    })
  })
})
