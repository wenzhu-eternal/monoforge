import { UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
    },
  },
}))

// L3：登录路径的 argon2 走 mock——单测不跑真实哈希运算
vi.mock('argon2', () => ({
  verify: vi.fn().mockResolvedValue(false),
  hash: vi.fn().mockResolvedValue('hashed'),
}))

// L19：getProfile 读 ADMIN_ROLE_ID 派生字段——固定为 1，断言不随运行环境漂移
vi.mock('@/config/env', () => ({
  getEnv: vi.fn(() => ({ ADMIN_ROLE_ID: 1 })),
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
    eval: ReturnType<typeof vi.fn>
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
      eval: vi.fn().mockResolvedValue(0),
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

  it('L3：Redis 抖动下 logout 降级放行，仍回 200 不抛 500', async () => {
    redisService.set.mockRejectedValueOnce(new Error('redis down'))

    await expect(service.logout(7)).resolves.toEqual({ message: '退出登录成功' })
  })

  describe('getProfile（L19 /auth/me 配置派生字段）', () => {
    function stubProfileDeps() {
      vi.spyOn(service as never, 'getPermissionsByUserId' as never).mockResolvedValue([
        'user:view',
      ] as never)
      vi.spyOn(service as never, 'getRoleByUserId' as never).mockResolvedValue({
        id: 1,
        name: 'admin',
        description: null,
      } as never)
    }

    it('超管命中配置 → 下发 adminRoleId 且 isAdmin=true', async () => {
      stubProfileDeps()

      const profile = await service.getProfile(7)

      expect(profile.adminRoleId).toBe(1)
      expect(profile.isAdmin).toBe(true)
      expect(profile.roles).toEqual([{ id: 1, name: 'admin', description: null }])
      expect(profile.permissions).toEqual(['user:view'])
    })

    it('非超管角色 → isAdmin=false，adminRoleId 照常下发（行级判定依据）', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue({ ...userRow, roleId: 2 } as never)
      stubProfileDeps()

      const profile = await service.getProfile(7)

      expect(profile.adminRoleId).toBe(1)
      expect(profile.isAdmin).toBe(false)
    })
  })

  describe('登录锁定（L3 原子化）', () => {
    it('L3: 检查与计数合并为单次 Lua，不再 GET-then-act', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined as never)

      await expect(service.login('u', 'pw', '1.2.3.4')).rejects.toThrow(UnauthorizedException)

      // 旧实现先 get 读计数再放行（并发全读旧值），现全程仅一次原子 eval
      expect(redisService.get).not.toHaveBeenCalled()
      expect(redisService.eval).toHaveBeenCalledTimes(1)
      const [script, keys, args] = redisService.eval.mock.calls[0] as [string, string[], number[]]
      expect(script).toContain('INCR')
      expect(script).toContain('EXPIRE')
      expect(keys[0]).toBe('login:fail:1.2.3.4:u')
      expect(args).toEqual([900, 10]) // LOGIN_FAIL_TTL=15min、LOGIN_FAIL_LIMIT=10
    })

    it('L3: 计数超限 → 429 且不再查库', async () => {
      redisService.eval.mockResolvedValue(1)

      await expect(service.login('u', 'pw', '1.2.3.4')).rejects.toThrow('登录失败次数过多')
      expect(db.query.users.findFirst).not.toHaveBeenCalled()
    })

    it('L3: Redis 故障降级放行，不因缓存抖动锁死登录', async () => {
      redisService.eval.mockRejectedValue(new Error('redis down'))
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined as never)

      // 走到密码校验（用户不存在 401），而非 redis 错误上抛
      await expect(service.login('u', 'pw', '1.2.3.4')).rejects.toThrow(UnauthorizedException)
    })
  })
})
