import { ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// L34：isAdminUser 依赖 getEnv().ADMIN_ROLE_ID，mock 固定为 1 保证单测不随 .env 漂移
// M3：E2E_MARKER 由用例按需注入，验证匿名回显口径
const envState = vi.hoisted(() => ({ E2E_MARKER: undefined as string | undefined }))
vi.mock('@/config/env', () => ({
  getEnv: () => ({ ADMIN_ROLE_ID: 1, E2E_MARKER: envState.E2E_MARKER }),
}))

import { HealthController } from './health.controller'
import type { HealthResult, HealthService } from './health.service'

describe('HealthController', () => {
  let controller: HealthController
  let service: HealthService

  beforeEach(() => {
    service = {
      check: vi.fn(),
    } as unknown as HealthService

    controller = new HealthController(service)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('check', () => {
    it('should return health status (unauthenticated)', async () => {
      const mockResult: HealthResult = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'ok',
        redis: 'ok',
      }

      vi.mocked(service.check).mockResolvedValue(mockResult)

      // biome-ignore lint/suspicious/noExplicitAny: test mock request
      const result = await controller.check({} as any)

      expect(result).toEqual({ status: 'ok', timestamp: mockResult.timestamp })
      expect(service.check).toHaveBeenCalledOnce()
    })

    it('L34：普通登录用户同样只返回基础状态（DB/Redis 明细不再"登录即可见"）', async () => {
      const mockResult: HealthResult = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'ok',
        redis: 'ok',
      }

      vi.mocked(service.check).mockResolvedValue(mockResult)

      // biome-ignore lint/suspicious/noExplicitAny: test mock request
      const result = await controller.check({ user: { sub: 5, roleId: 2 } } as any)

      expect(result).toEqual({ status: 'ok', timestamp: mockResult.timestamp })
    })

    it('should return full details (admin)', async () => {
      const mockResult: HealthResult = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'ok',
        redis: 'ok',
      }

      vi.mocked(service.check).mockResolvedValue(mockResult)

      // biome-ignore lint/suspicious/noExplicitAny: test mock request
      const result = await controller.check({ user: { sub: 1, roleId: 1 } } as any)

      expect(result).toEqual(mockResult)
      expect(service.check).toHaveBeenCalledOnce()
    })

    it('M3：注入 E2E_MARKER 时匿名回显指纹，未注入时字段不出现', async () => {
      vi.mocked(service.check).mockResolvedValue({
        status: 'ok',
        timestamp: '2026-10-28T00:00:00.000Z',
        database: 'ok',
        redis: 'ok',
      })

      const anonymous = await controller.check({} as never)
      expect(anonymous).not.toHaveProperty('e2eMarker')

      envState.E2E_MARKER = 'monoforge-e2e'
      const withMarker = await controller.check({} as never)
      expect(withMarker).toEqual({
        status: 'ok',
        timestamp: '2026-10-28T00:00:00.000Z',
        e2eMarker: 'monoforge-e2e',
      })

      envState.E2E_MARKER = undefined
    })

    it('should throw 503 when database error', async () => {
      const mockResult: HealthResult = {
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'error',
        redis: 'error',
      }

      vi.mocked(service.check).mockResolvedValue(mockResult)

      // biome-ignore lint/suspicious/noExplicitAny: test mock request
      await expect(controller.check({} as any)).rejects.toThrow(ServiceUnavailableException)
      expect(service.check).toHaveBeenCalledOnce()
    })
  })

  it('L5：类级 @Throttle 60/min 生效且不再 @SkipThrottle（防公开端点被无限探测）', () => {
    // @nestjs/throttler 装饰器契约：元数据键 = THROTTLER_TTL/LIMIT/SKIP + 节流组名
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', HealthController)).toBe(60_000)
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', HealthController)).toBe(60)
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', HealthController)).toBeUndefined()
  })

  it('L11：@Public 与 @OptionalAuth 并存（详情按 token 裁剪，而非对所有人不可见）', () => {
    expect(Reflect.getMetadata('isPublic', HealthController)).toBe(true)
    expect(Reflect.getMetadata('optionalAuth', HealthController)).toBe(true)
  })
})
