import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import { and, eq } from 'drizzle-orm'
import type { Request } from 'express'
import { IS_OPTIONAL_AUTH_KEY } from '@/common/decorators/optional-auth.decorator'
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator'
import { isAdminUser } from '@/common/utils/is-admin'
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
  private readonly logger = new Logger(AuthGuard.name)

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
    // L11：@OptionalAuth 的公开路由继续走解析（仅用于按身份裁剪响应），但绝不以 401 拒绝；
    // 其余公开路由仍早退，避免为 login/register 等请求平白验签（也防旧 token 污染审计归因）
    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    // L13：@OptionalAuth 必须与 @Public 同用——组合断层时端点走完整鉴权无害但零告警，
    // 未来误改会把"按身份裁剪"意外变成"强制登录"，此处显式告警防静默
    if (isOptionalAuth && !isPublic) {
      this.logger.warn('检测到 @OptionalAuth 未与 @Public 同用，请确认是否为预期组合')
    }
    if (isPublic && !isOptionalAuth) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = this.extractTokenFromHeader(request)

    if (!token) {
      if (isOptionalAuth) return true
      throw new UnauthorizedException('缺少访问令牌')
    }

    try {
      const secret = this.configService.get<string>('JWT_SECRET')
      // 显式算法白名单，防算法混淆
      const payload = await this.jwtService.verifyAsync(token, { secret, algorithms: ['HS256'] })

      // 可选鉴权只信任验签结果，跳过吊销/存续/强制改密等拒绝型复检
      if (isOptionalAuth) {
        // L10：仍需存续复检——health 按 token roleId 裁剪管理员详情，禁用/软删后旧 AT
        // 不得继续拿到管理员视图；isAccountAlive 有 5s 正向缓存，成本可忽略
        if (!(await this.isAccountAlive(payload.sub))) {
          return true
        }
        // 超管快径复检角色——被降级（DB roleId 已变）后旧 token 仍以旧 roleId 走管理员裁剪
        if (isAdminUser(payload)) {
          const record = await db.query.users.findFirst({
            where: and(eq(users.id, payload.sub), notDeleted(users.deletedAt)),
            columns: { roleId: true },
          })
          if (!record || record.roleId !== payload.roleId) {
            return true
          }
        }
        request.user = payload
        return true
      }

      // 检查 access token 是否已被吊销（logout/禁用/改角色/改密（含管理员重置）/删用户时 jti 进入 Redis 黑名单）
      if (payload.jti) {
        // L7：Redis 抖动降级放行（JWT 本身已验签，跳过本次黑名单复检，不吞成 401）
        let revoked: string | null = null
        try {
          revoked = await this.redisService.get(`access:${payload.sub}:${payload.jti}`)
        } catch {
          // 继续，视为未吊销
        }
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
      // 可选鉴权：任何解析失败都静默降级为匿名访问，不返回 401
      if (isOptionalAuth) return true
      if (err instanceof UnauthorizedException || err instanceof ServiceUnavailableException) {
        throw err
      }
      throw new UnauthorizedException('访问令牌无效')
    }

    return true
  }

  /** L12：账号存续复检——正向 5s Redis 缓存；未命中直查 DB（软删/禁用均判死） */
  private async isAccountAlive(sub: number): Promise<boolean> {
    const cacheKey = `user:alive:${sub}`
    // L7：Redis get 抖动降级为缓存未命中，继续查 DB，不吞成 401
    let cached: string | null = null
    try {
      cached = await this.redisService.get(cacheKey)
    } catch {
      // 继续查 DB
    }
    if (cached === '1') {
      return true
    }
    try {
      const record = await db.query.users.findFirst({
        where: and(eq(users.id, sub), notDeleted(users.deletedAt)),
        columns: { status: true },
      })
      if (record == null || record.status === false) {
        return false
      }
      // L7：Redis set 抖动不影响结果，仅记忆缓存失败
      try {
        await this.redisService.set(cacheKey, '1', 5)
      } catch {
        // 忽略
      }
      return true
    } catch (err) {
      // L4：DB 抖动不吞成"访问令牌无效"——抛 ServiceUnavailableException，由 canActivate 透传
      //（与 PermissionsGuard 的"DB 异常直接 500"口径一致，避免全站误登出）
      throw new ServiceUnavailableException('账号存续检查失败，服务暂不可用')
    }
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
