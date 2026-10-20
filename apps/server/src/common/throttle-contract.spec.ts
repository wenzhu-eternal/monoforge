import type { ExecutionContext } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEnv } from '@/config/env'
import { AuthController } from '@/modules/auth/auth.controller'
import { ErrorLogsController } from '@/modules/error-logs/error-logs.controller'
import { NotificationsController } from '@/modules/notifications/notifications.controller'
import type { RedisService } from '@/modules/redis/redis.service'
import { CustomThrottlerGuard } from './guards/throttler.guard'
import { buildThrottlerOptions } from './throttler-options'

// 与 env.ts THROTTLE_LIMIT 默认值保持一致（L15③ 提到 60/min）
const DEFAULT_LIMIT = 60

function fakeConfig(throttleBypass: string): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => {
      if (key === 'ALLOW_THROTTLE_BYPASS') return throttleBypass
      if (key === 'THROTTLE_TTL') return 60
      if (key === 'THROTTLE_LIMIT') return DEFAULT_LIMIT
      return fallback
    },
  } as unknown as ConfigService
}

function buildContext(cls: unknown, handler: unknown): ExecutionContext {
  return {
    getClass: () => cls,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ ip: '203.0.113.7', headers: {}, user: { sub: 7 } }),
      getResponse: () => ({ header: vi.fn() }),
    }),
  } as unknown as ExecutionContext
}

describe('限流契约（M5）', () => {
  const storage = { increment: vi.fn() }
  let guard: CustomThrottlerGuard

  beforeEach(async () => {
    storage.increment.mockReset().mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60_000,
      isBlocked: false,
      timeToBlockExpire: 0,
    })
    guard = new CustomThrottlerGuard(
      [{ ttl: 60_000, limit: DEFAULT_LIMIT }],
      storage as never,
      new Reflector(),
    )
    await guard.onModuleInit()
  })

  async function resolveLimit(cls: unknown, handler: unknown): Promise<number> {
    await guard.canActivate(buildContext(cls, handler))
    return storage.increment.mock.calls[0][2] as number
  }

  it('login 命中 THROTTLE_LOGIN_LIMIT（default 共享桶，无 SkipThrottle）', async () => {
    expect(await resolveLimit(AuthController, AuthController.prototype.login)).toBe(
      getEnv().THROTTLE_LOGIN_LIMIT,
    )
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', AuthController.prototype.login),
    ).toBeUndefined()
  })

  it('公开错误上报 3/min', async () => {
    expect(await resolveLimit(ErrorLogsController, ErrorLogsController.prototype.reportError)).toBe(
      3,
    )
  })

  it('error-logs 详情 60/min（查询端点不得 @SkipThrottle 无限制）', async () => {
    expect(await resolveLimit(ErrorLogsController, ErrorLogsController.prototype.findOne)).toBe(60)
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', ErrorLogsController.prototype.findOne),
    ).toBeUndefined()
  })

  it('无装饰器端点继承默认 THROTTLE_LIMIT', async () => {
    expect(
      await resolveLimit(NotificationsController, NotificationsController.prototype.list),
    ).toBe(DEFAULT_LIMIT)
  })

  it('L15①：仅显式 ALLOW_THROTTLE_BYPASS 才旁路，生产默认不旁路', () => {
    const prod = buildThrottlerOptions(fakeConfig('false'), {} as RedisService) as {
      skipIf: () => boolean
      throttlers: Array<{ ttl: number; limit: number }>
    }
    const bypass = buildThrottlerOptions(fakeConfig('true'), {} as RedisService) as {
      skipIf: () => boolean
    }
    expect(prod.skipIf()).toBe(false)
    expect(bypass.skipIf()).toBe(true)
    expect(prod.throttlers).toEqual([{ ttl: 60_000, limit: DEFAULT_LIMIT }])
  })
})
