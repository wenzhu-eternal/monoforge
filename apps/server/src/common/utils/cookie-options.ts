import type { ConfigService } from '@nestjs/config'
import type { CookieOptions } from 'express'

const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000

export function getRefreshTokenCookieOptions(configService: ConfigService): CookieOptions {
  const secure =
    configService.get<string | boolean>('COOKIE_SECURE') === true ||
    configService.get<string | boolean>('COOKIE_SECURE') === 'true'
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_MAX_AGE,
    path: '/api/v1/auth',
  }
}
