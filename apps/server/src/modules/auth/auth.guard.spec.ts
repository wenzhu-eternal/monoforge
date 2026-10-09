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
})
