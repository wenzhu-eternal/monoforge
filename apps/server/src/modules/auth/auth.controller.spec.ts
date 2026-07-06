import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthController } from './auth.controller'
import type { AuthService } from './auth.service'

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

      expect(result).toEqual({ accessToken: 'access-token', user: mockResult.user })
      expect(authService.login).toHaveBeenCalledWith('admin', 'Pass1234')
      expect(response.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/api/v1/auth',
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

      const result = await controller.refresh(request, undefined, response as never)

      expect(result).toEqual({ accessToken: 'new-access' })
      expect(authService.refresh).toHaveBeenCalledWith('cookie-token')
      expect(response.cookie).toHaveBeenCalled()
    })

    it('cookie 不存在时从 body 兜底', async () => {
      const request = { cookies: {} } as never
      const mockTokens = { accessToken: 'new-access', refreshToken: 'new-refresh' }
      vi.mocked(authService.refresh).mockResolvedValue(mockTokens as never)

      const result = await controller.refresh(request, 'body-token', response as never)

      expect(result).toEqual({ accessToken: 'new-access' })
      expect(authService.refresh).toHaveBeenCalledWith('body-token')
    })

    it('cookie 和 body 都没有时抛 UnauthorizedException', async () => {
      const request = { cookies: {} } as never

      await expect(controller.refresh(request, undefined, response as never)).rejects.toThrow(
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
      expect(response.clearCookie).toHaveBeenCalledWith('refreshToken', { path: '/api/v1/auth' })
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
})
