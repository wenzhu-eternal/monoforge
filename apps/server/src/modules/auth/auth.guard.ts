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

      // 检查 access token 是否已被吊销（logout/禁用/改角色/用户自改密/删用户时 jti 进入 Redis 黑名单；管理员改密暂不吊销）
      if (payload.jti) {
        const revoked = await this.redisService.get(`access:${payload.sub}:${payload.jti}`)
        if (revoked === '1') {
          throw new UnauthorizedException('访问令牌已吊销')
        }
      }

      // 强制改密场景：mustChangePassword 为 true 时，仅允许改密/个人信息/登出接口
      // 精确匹配 method + path，避免 startsWith 匹配子路径绕过
      if (payload.mustChangePassword) {
        const method = request.method.toUpperCase()
        const path = request.path
        const allowed = [
          { method: 'POST', path: '/api/v1/users/me/password' }, // 改密
          { method: 'GET', path: '/api/v1/auth/me' }, // 获取个人信息
          { method: 'POST', path: '/api/v1/auth/logout' }, // 登出
        ]
        if (!allowed.some((p) => method === p.method && path === p.path)) {
          throw new UnauthorizedException('请先修改默认密码')
        }
      }

      request.user = payload
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err
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
