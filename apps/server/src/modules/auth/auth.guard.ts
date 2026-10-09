import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import { and, eq } from 'drizzle-orm'
import type { Request } from 'express'
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { users } from '@/db/schema'
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
      // 显式算法白名单，防算法混淆
      const payload = await this.jwtService.verifyAsync(token, { secret, algorithms: ['HS256'] })

      // 检查 access token 是否已被吊销（logout/禁用/改角色/改密（含管理员重置）/删用户时 jti 进入 Redis 黑名单）
      if (payload.jti) {
        const revoked = await this.redisService.get(`access:${payload.sub}:${payload.jti}`)
        if (revoked === '1') {
          throw new UnauthorizedException('访问令牌已吊销')
        }
      }

      // L12：账号存续薄复检——禁用/软删的强制力原全押 Redis 吊销，revoke 部分失败
      // （DB 已提交）时，无 @Permissions 的路由（/users/me/password、/notifications*、
      // /websocket/notify）不经 PermissionsGuard 复检，存在 ≤15min 可达窗口。
      // 正向 5s 缓存免查库；负结果不缓存，恢复/重新登录即时生效
      if (!(await this.isAccountAlive(payload.sub))) {
        throw new UnauthorizedException('账号已被禁用或删除')
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
          throw new UnauthorizedException(ErrorMessages[ErrorCodes.MUST_CHANGE_PASSWORD])
        }
      }

      request.user = payload
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err
      throw new UnauthorizedException('访问令牌无效')
    }

    return true
  }

  /** L12：账号存续复检——正向 5s Redis 缓存；未命中直查 DB（软删/禁用均判死） */
  private async isAccountAlive(sub: number): Promise<boolean> {
    const cacheKey = `user:alive:${sub}`
    if ((await this.redisService.get(cacheKey)) === '1') {
      return true
    }
    const record = await db.query.users.findFirst({
      where: and(eq(users.id, sub), notDeleted(users.deletedAt)),
      columns: { status: true },
    })
    if (record == null || record.status === false) {
      return false
    }
    await this.redisService.set(cacheKey, '1', 5)
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
