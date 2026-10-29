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
const { AuthGuard } = await import('./auth.guard')

describe('AuthGuard（L12 账号存续薄复检）', () => {
  let guard: InstanceType<typeof AuthGuard>
  let redis: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
  }

  function makeContext() {
    const request = {
      headers: { authorization: 'Bearer token' },
      method: 'GET',
      path: '/api/v1/notifications',
    }
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as never
  }

  beforeEach(() => {
    vi.clearAllMocks()
    redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    }
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: 9,
        username: 'u',
        email: 'u@e.com',
        roleId: 1,
        jti: 'jti-1',
      }),
    }
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) }
    const config = { get: vi.fn().mockReturnValue('secret') }
    guard = new AuthGuard(jwt as never, config as never, reflector as never, redis as never)
    vi.mocked(db.query.users.findFirst).mockResolvedValue({ status: true } as never)
  })

  it('DB 已禁用（吊销缺失场景）→ 401', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({ status: false } as never)

    await expect(guard.canActivate(makeContext())).rejects.toThrow('账号已被禁用或删除')
  })

  it('软删/用户不存在 → 401', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined as never)

    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException)
  })

  it('正向缓存命中 → 放行且不查 DB', async () => {
    redis.get.mockImplementation((key: string) =>
      Promise.resolve(key.startsWith('user:alive:') ? '1' : null),
    )

    await expect(guard.canActivate(makeContext())).resolves.toBe(true)
    expect(db.query.users.findFirst).not.toHaveBeenCalled()
  })

  it('DB 存活 → 放行并写 5s 正向缓存', async () => {
    await expect(guard.canActivate(makeContext())).resolves.toBe(true)

    expect(redis.set).toHaveBeenCalledWith('user:alive:9', '1', 5)
  })

  it('负结果不缓存（恢复/重新登录即时生效）', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({ status: false } as never)

    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('L4：AT 的 iat 早于最近登出 → 401（logout 场景无 DB 复检兜底，覆盖吊销链非原子窗口）', async () => {
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 9, roleId: 1, jti: 'jti-1', iat: 1000 }),
    }
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) }
    const config = { get: vi.fn().mockReturnValue('secret') }
    const logoutRedis = {
      get: vi.fn((key: string) =>
        Promise.resolve(key.startsWith('logout:at:') ? '9999999999999' : null),
      ),
      set: vi.fn(),
    }
    const g = new AuthGuard(jwt as never, config as never, reflector as never, logoutRedis as never)

    await expect(g.canActivate(makeContext())).rejects.toThrow('访问令牌已吊销')
    expect(db.query.users.findFirst).not.toHaveBeenCalled()
  })

  describe('L11 可选鉴权（health 详情按 token 裁剪）', () => {
    function buildOptionalGuard(opts: { token?: string; verify?: () => Promise<unknown> }) {
      const jwt = { verifyAsync: vi.fn(opts.verify ?? (async () => ({ sub: 1, roleId: 1 }))) }
      const reflector = {
        getAllAndOverride: vi.fn((key: string) => key === 'isPublic' || key === 'optionalAuth'),
      }
      const config = { get: vi.fn().mockReturnValue('secret') }
      const optionalGuard = new AuthGuard(
        jwt as never,
        config as never,
        reflector as never,
        redis as never,
      )
      const request: Record<string, unknown> = {
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
        method: 'GET',
        path: '/api/v1/health',
      }
      const ctx = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => request }),
      } as never
      return { optionalGuard, request, ctx }
    }

    it('L10：有效 token（存活且角色未变）→ 附加 user 后放行', async () => {
      const { optionalGuard, request, ctx } = buildOptionalGuard({ token: 'valid' })
      // isAccountAlive 查 status + 超管角色复检查 roleId，均回滚同值
      vi.mocked(db.query.users.findFirst).mockResolvedValue({ status: true, roleId: 1 } as never)

      await expect(optionalGuard.canActivate(ctx)).resolves.toBe(true)
      expect(request.user).toMatchObject({ sub: 1, roleId: 1 })
    })

    it('L10：超管被降级（DB roleId 已变）→ 视为匿名，不附加 user', async () => {
      const { optionalGuard, request, ctx } = buildOptionalGuard({ token: 'valid' })
      vi.mocked(db.query.users.findFirst).mockResolvedValue({ status: true, roleId: 2 } as never)

      await expect(optionalGuard.canActivate(ctx)).resolves.toBe(true)
      expect(request.user).toBeUndefined()
    })

    it('无 token → 匿名放行，不抛 401', async () => {
      const { optionalGuard, ctx } = buildOptionalGuard({})

      await expect(optionalGuard.canActivate(ctx)).resolves.toBe(true)
    })

    it('无效 token → 静默降级为匿名，不抛 401', async () => {
      const { optionalGuard, request, ctx } = buildOptionalGuard({
        token: 'bad',
        verify: async () => {
          throw new Error('bad token')
        },
      })

      await expect(optionalGuard.canActivate(ctx)).resolves.toBe(true)
      expect(request.user).toBeUndefined()
    })
  })
})
