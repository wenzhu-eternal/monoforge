import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { AuthResponseSchema, RefreshTokenResponseSchema } from '@shared/schemas/auth'
import { UserSchema } from '@shared/schemas/user'
import type { Request, Response } from 'express'
import { ZodSerializerDto } from 'nestjs-zod'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Public } from '@/common/decorators/public.decorator'
import { getRefreshTokenCookieOptions } from '@/common/utils/cookie-options'
import { AuthService, type TokenPayload } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { SendRegisterCodeDto } from './dto/send-register-code.dto'

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录' })
  @ZodSerializerDto(AuthResponseSchema)
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(loginDto.username, loginDto.password)

    response.cookie(
      'refreshToken',
      result.refreshToken,
      getRefreshTokenCookieOptions(this.configService),
    )

    return {
      accessToken: result.accessToken,
      user: result.user,
    }
  }

  @Post('send-register-code')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送注册验证码' })
  async sendRegisterCode(@Body() dto: SendRegisterCodeDto) {
    return this.authService.sendRegisterCode(dto.email)
  }

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户注册' })
  @ZodSerializerDto(AuthResponseSchema)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.registerWithCode(
      dto.username,
      dto.email,
      dto.password,
      dto.code,
    )

    response.cookie(
      'refreshToken',
      result.refreshToken,
      getRefreshTokenCookieOptions(this.configService),
    )

    return {
      accessToken: result.accessToken,
      user: result.user,
    }
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新访问令牌' })
  @ZodSerializerDto(RefreshTokenResponseSchema)
  async refresh(
    @Req() request: Request,
    @Body('refreshToken') refreshTokenFromBody: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.refreshToken ?? refreshTokenFromBody
    if (!refreshToken) {
      throw new UnauthorizedException('缺少刷新令牌')
    }

    const tokens = await this.authService.refresh(refreshToken)

    response.cookie(
      'refreshToken',
      tokens.refreshToken,
      getRefreshTokenCookieOptions(this.configService),
    )

    return {
      accessToken: tokens.accessToken,
    }
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登出' })
  async logout(
    @CurrentUser() user: TokenPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.clearCookie('refreshToken', { path: '/' })
    const authHeader = request.headers.authorization
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    return this.authService.logout(user.sub, accessToken)
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息' })
  @ZodSerializerDto(UserSchema)
  async getProfile(@CurrentUser() user: TokenPayload) {
    return this.authService.getProfile(user.sub)
  }
}
