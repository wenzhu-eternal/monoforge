import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthController } from './auth.controller'
import type { AuthService } from './auth.service'

const mockGetEnv = vi.fn()

vi.mock('@/config/env', () => ({
  getEnv: (...args: unknown[]) => mockGetEnv(...(args as Parameters<typeof mockGetEnv>)),
}))

describe('AuthController', () => {
  let controller: AuthController
  let authService: AuthService
  let configService: ConfigService
  let response: { cookie: ReturnType<typeof vi.fn>; clearCookie: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    authService = {
      login: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(),
      getProfile: vi.fn(),
    } as unknown as AuthService

    configService = {
      get: vi.fn().mockReturnValue(false),
    } as unknown as ConfigService

    response = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    }

    controller = new AuthController(authService, configService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('login', () => {
    it('登录成功并设置 httpOnly cookie', async () => {
      const loginDto = { username: 'admin', password: 'Pass1234' }
      const mockResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 1, username: 'admin' },
      }
      vi.mocked(authService.login).mockResolvedValue(mockResult as never)

      const result = await controller.login(loginDto, response as never)

      expect(result).toEqual({
        accessToken: 'access-token',
        user: mockResult.user,
      })
      expect(authService.login).toHaveBeenCalledWith('admin', 'Pass1234')
      expect(response.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
        }),
      )
    })

    it('COOKIE_SECURE=true 时 cookie secure 为 true', async () => {
      vi.mocked(configService.get).mockReturnValue(true)
      vi.mocked(authService.login).mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        user: { id: 1 },
      } as never)

      await controller.login({ username: 'a', password: 'b' }, response as never)

      expect(response.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'r',
        expect.objectContaining({ secure: true }),
      )
    })
  })

  describe('refresh', () => {
    it('从 httpOnly cookie 读取 refreshToken 并刷新', async () => {
      const request = { cookies: { refreshToken: 'cookie-token' } } as never
      const mockTokens = { accessToken: 'new-access', refreshToken: 'new-refresh' }
      vi.mocked(authService.refresh).mockResolvedValue(mockTokens as never)

      const result = await controller.refresh(request, response as never)

      expect(result).toEqual({ accessToken: 'new-access' })
      expect(authService.refresh).toHaveBeenCalledWith('cookie-token')
      expect(response.cookie).toHaveBeenCalled()
    })

    it('请求体带 refreshToken 也无法绕过 cookie 缺失，仍抛 401', async () => {
      const request = {
        cookies: {},
        body: { refreshToken: 'body-token' },
      } as never

      await expect(controller.refresh(request, response as never)).rejects.toThrow(
        UnauthorizedException,
      )
      expect(authService.refresh).not.toHaveBeenCalled()
    })

    it('cookie 不存在时抛 UnauthorizedException', async () => {
      const request = { cookies: {} } as never

      await expect(controller.refresh(request, response as never)).rejects.toThrow(
        UnauthorizedException,
      )
      expect(authService.refresh).not.toHaveBeenCalled()
    })
  })

  describe('logout', () => {
    it('登出并清除 cookie', async () => {
      const user = { sub: 1 }
      vi.mocked(authService.logout).mockResolvedValue({ message: '已登出' } as never)

      const result = await controller.logout(user as never, response as never)

      expect(result).toEqual({ message: '已登出' })
      expect(authService.logout).toHaveBeenCalledWith(1)
      expect(response.clearCookie).toHaveBeenCalledWith('refreshToken', { path: '/' })
    })
  })

  describe('getProfile', () => {
    it('返回当前用户信息', async () => {
      const user = { sub: 1 }
      const mockProfile = { id: 1, username: 'admin' }
      vi.mocked(authService.getProfile).mockResolvedValue(mockProfile as never)

      const result = await controller.getProfile(user as never)

      expect(result).toEqual(mockProfile)
      expect(authService.getProfile).toHaveBeenCalledWith(1)
    })
  })

  describe('ALLOW_REGISTER 开关', () => {
    it('关闭时 sendRegisterCode 直接 404（隐藏端点存在性）', async () => {
      mockGetEnv.mockReturnValue({ ALLOW_REGISTER: false })

      await expect(controller.sendRegisterCode({ email: 'a@b.com' } as never)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('关闭时 register 直接 404', async () => {
      mockGetEnv.mockReturnValue({ ALLOW_REGISTER: false })

      await expect(
        controller.register(
          { username: 'u', email: 'a@b.com', password: 'p', code: '123456' } as never,
          response as never,
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('开启时 register 正常透传', async () => {
      mockGetEnv.mockReturnValue({ ALLOW_REGISTER: true })
      ;(authService as unknown as Record<string, ReturnType<typeof vi.fn>>).registerWithCode = vi
        .fn()
        .mockResolvedValue({ accessToken: 'a', refreshToken: 'r', user: { id: 1 } })

      const result = await controller.register(
        { username: 'u', email: 'a@b.com', password: 'p', code: '123456' } as never,
        response as never,
      )

      expect(result).toEqual({ accessToken: 'a', user: { id: 1 } })
    })
  })
})
