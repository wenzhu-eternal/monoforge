import { UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
    },
  },
}))

const { db } = await import('@/db')
const { AuthService } = await import('./auth.service')

describe('AuthService（L7 登出失效时间戳）', () => {
  let service: InstanceType<typeof AuthService>
  let jwtService: {
    verifyAsync: ReturnType<typeof vi.fn>
    signAsync: ReturnType<typeof vi.fn>
  }
  let redisService: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    getdel: ReturnType<typeof vi.fn>
    deleteByPattern: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
    scanKeys: ReturnType<typeof vi.fn>
  }

  const userRow = {
    id: 7,
    username: 'u',
    email: 'u@e.com',
    roleId: 1,
    status: true,
    mustChangePassword: false,
    deletedAt: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    jwtService = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: 7,
        username: 'u',
        email: 'u@e.com',
        roleId: 1,
        jti: 'refresh-jti',
        iat: 1000,
      }),
      signAsync: vi.fn().mockResolvedValue('signed-token'),
    }
    redisService = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getdel: vi.fn().mockResolvedValue('1'),
      deleteByPattern: vi.fn().mockResolvedValue(0),
      del: vi.fn().mockResolvedValue(undefined),
      scanKeys: vi.fn().mockResolvedValue([]),
    }
    const configService = { get: vi.fn().mockReturnValue('secret') }
    service = new AuthService(
      jwtService as never,
      configService as never,
      redisService as never,
      {} as never,
    )
    vi.mocked(db.query.users.findFirst).mockResolvedValue(userRow as never)
  })

  it('签发时间早于最近登出 → 早退拒绝且不消耗 getdel', async () => {
    redisService.get.mockImplementation((key: string) =>
      Promise.resolve(key.startsWith('logout:at:') ? '9999999999999' : null),
    )

    await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException)
    expect(redisService.getdel).not.toHaveBeenCalled()
  })

  it('早退与落盘之间发生的登出 → 签发后复检拒绝', async () => {
    let logoutReads = 0
    redisService.get.mockImplementation((key: string) => {
      if (key.startsWith('logout:at:')) {
        logoutReads += 1
        return Promise.resolve(logoutReads === 1 ? null : '9999999999999')
      }
      return Promise.resolve(null)
    })

    await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException)
    // 复检发生在 storeRefreshTokenForExternal 之后（竞态窗口内 getdel 已完成）
    expect(logoutReads).toBe(2)
    expect(redisService.getdel).toHaveBeenCalled()
  })

  it('无登出记录 → 正常签发令牌对', async () => {
    const tokens = await service.refresh('token')

    expect(tokens.accessToken).toBe('signed-token')
    expect(redisService.set).toHaveBeenCalledWith(
      expect.stringContaining('access:active:7:'),
      '1',
      15 * 60,
    )
  })

  it('logout 先落 logout:at 时间戳再删 refresh 模式', async () => {
    await service.logout(7)

    const setOrder = redisService.set.mock.invocationCallOrder[0]
    const delOrder = redisService.deleteByPattern.mock.invocationCallOrder[0]
    expect(setOrder).toBeLessThan(delOrder)
    expect(redisService.set).toHaveBeenCalledWith(
      'logout:at:7',
      expect.any(String),
      7 * 24 * 60 * 60 + 86400,
    )
    expect(Number(redisService.set.mock.calls[0][1])).toBeGreaterThan(0)
    expect(redisService.deleteByPattern).toHaveBeenCalledWith('refresh:7:*')
  })
})
