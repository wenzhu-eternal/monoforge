import { ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// L34：isAdminUser 依赖 getEnv().ADMIN_ROLE_ID，mock 固定为 1 保证单测不随 .env 漂移
vi.mock('@/config/env', () => ({
  getEnv: () => ({ ADMIN_ROLE_ID: 1 }),
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
})
