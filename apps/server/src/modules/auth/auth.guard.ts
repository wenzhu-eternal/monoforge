import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator'
import { RedisService } from '@/modules/redis/redis.service'

interface AuthenticatedRequest extends Request {
  user?: {
    sub: number
    username: string
    email: string
    roleId: number | null
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = this.extractTokenFromHeader(request)

    if (!token) {
      throw new UnauthorizedException('缺少访问令牌')
    }

    try {
      const secret = this.configService.get<string>('JWT_SECRET')
      const payload = await this.jwtService.verifyAsync(token, { secret })

      // 检查 access token 是否已被吊销（logout 后 jti 进入 Redis 黑名单）
      if (payload.jti) {
        const revoked = await this.redisService.get(`access:${payload.sub}:${payload.jti}`)
        if (revoked === '1') {
          throw new UnauthorizedException('访问令牌已吊销')
        }
      }

      request.user = payload
    } catch {
      throw new UnauthorizedException('访问令牌无效')
    }

    return true
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization
    if (!authHeader) {
      return undefined
    }

    const [type, token] = authHeader.split(' ')
    return type === 'Bearer' ? token : undefined
  }
}
