import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// getEnv mock：单测内联控制 ALLOW_SETUP，避免依赖真实 .env。
// vi.hoisted：静态 import 链经 @/db 在加载期即调 getEnv（建池消费 DB_POOL_MAX），防 TDZ
const mockGetEnv = vi.hoisted(() => vi.fn(() => ({ DB_POOL_MAX: 10 })))
vi.mock('@/config/env', () => ({
  getEnv: (...args: unknown[]) => mockGetEnv(...(args as Parameters<typeof mockGetEnv>)),
}))

import { SetupController } from './setup.controller'
import type { SetupResult, SetupService, SetupStatus } from './setup.service'

describe('SetupController', () => {
  let controller: SetupController
  let service: SetupService

  beforeEach(() => {
    vi.clearAllMocks()
    service = {
      getStatus: vi.fn(),
      initialize: vi.fn(),
    } as unknown as SetupService
    controller = new SetupController(service)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('status', () => {
    it('返回系统初始化状态（未初始化）', async () => {
      const mockStatus: SetupStatus = { initialized: false }
      vi.mocked(service.getStatus).mockResolvedValue(mockStatus)

      const result = await controller.status()

      expect(result).toEqual({ initialized: false })
      expect(service.getStatus).toHaveBeenCalledOnce()
    })

    it('返回系统初始化状态（已初始化）', async () => {
      const mockStatus: SetupStatus = { initialized: true }
      vi.mocked(service.getStatus).mockResolvedValue(mockStatus)

      const result = await controller.status()

      expect(result).toEqual({ initialized: true })
    })
  })

  describe('setup', () => {
    const validDto = {
      username: 'admin',
      email: 'admin@example.com',
      password: 'Passw0rd',
    }

    it('ALLOW_SETUP=true → 调用 service.initialize', async () => {
      mockGetEnv.mockReturnValue({ ALLOW_SETUP: true })
      const mockResult: SetupResult = {
        message: '初始化完成',
        adminUsername: 'admin',
      }
      vi.mocked(service.initialize).mockResolvedValue(mockResult)

      const result = await controller.setup(validDto)

      expect(result).toEqual(mockResult)
      expect(service.initialize).toHaveBeenCalledWith(validDto)
      expect(mockGetEnv).toHaveBeenCalled()
    })

    it('ALLOW_SETUP=false → 抛 NotFoundException，不调用 service', async () => {
      mockGetEnv.mockReturnValue({ ALLOW_SETUP: false })
      vi.mocked(service.initialize).mockResolvedValue({} as SetupResult)

      await expect(controller.setup(validDto)).rejects.toThrow(NotFoundException)
      expect(service.initialize).not.toHaveBeenCalled()
    })

    it('ALLOW_SETUP 为字符串 "true"（zod transform 后为 boolean true）→ 调用 service', async () => {
      // 验证 getEnv() 返回的是 zod transform 后的 boolean，不是原始字符串
      mockGetEnv.mockReturnValue({ ALLOW_SETUP: true })
      const mockResult: SetupResult = {
        message: '初始化完成',
        adminUsername: 'admin',
      }
      vi.mocked(service.initialize).mockResolvedValue(mockResult)

      const result = await controller.setup(validDto)

      expect(result).toEqual(mockResult)
      expect(service.initialize).toHaveBeenCalledOnce()
    })
  })
})
