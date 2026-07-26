import { ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

    it('should return full details (authenticated)', async () => {
      const mockResult: HealthResult = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'ok',
        redis: 'ok',
      }

      vi.mocked(service.check).mockResolvedValue(mockResult)

      // biome-ignore lint/suspicious/noExplicitAny: test mock request
      const result = await controller.check({ user: { sub: 1 } } as any)

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
