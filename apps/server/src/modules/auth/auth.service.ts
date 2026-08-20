import { randomInt, randomUUID } from 'node:crypto'
import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import type { RoleBrief } from '@shared/schemas/role'
import * as argon2 from 'argon2'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, notDeleted } from '@/db/helpers'
import type { User } from '@/db/schema'
import { permissions, rolePermissions, roles, users } from '@/db/schema'
import { MailService } from '@/modules/mail/mail.service'
import { RedisService } from '@/modules/redis/redis.service'

export interface TokenPayload {
  sub: number
  username: string
  email: string
  roleId: number | null
  mustChangePassword?: boolean
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
  ) {}

  async login(
    username: string,
    password: string,
  ): Promise<
    TokenPair & { user: Omit<User, 'password'> & { permissions: string[]; roles: RoleBrief[] } }
  > {
    const user = await db.query.users.findFirst({
      where: and(eq(users.username, username), notDeleted(users.deletedAt)),
    })

    if (!user) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_PASSWORD])
    }

    const isPasswordValid = await argon2.verify(user.password, password)
    if (!isPasswordValid) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_PASSWORD])
    }

    if (user.status === false) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.USER_DISABLED])
    }

    const tokens = await this.signTokenPair({
      sub: user.id,
      username: user.username,
      email: user.email,
      roleId: user.roleId,
      mustChangePassword: user.mustChangePassword,
    })

    await this.storeRefreshTokenForExternal(tokens.refreshToken, user.id)

    const permissions = await this.getPermissionsByUserId(user.id)
    const role = await this.getRoleByUserId(user.id)
    const { password: _, ...userWithoutPassword } = user

    return {
      ...tokens,
      user: { ...userWithoutPassword, permissions, roles: role ? [role] : [] },
    }
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: {
      sub: number
      username: string
      email: string
      roleId?: number | null
      jti?: string
    }
    try {
      const secret = this.configService.get<string>('JWT_REFRESH_SECRET')
      payload = await this.jwtService.verifyAsync(refreshToken, { secret })
    } catch {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.REFRESH_TOKEN_INVALID])
    }

    // 原子 get+del 校验并作废旧 token（防并发重放）
    const stored = await this.redisService.getdel(`refresh:${payload.sub}:${payload.jti}`)
    if (stored !== '1') {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_TOKEN])
    }

    const user = await db.query.users.findFirst({
      where: and(eq(users.id, payload.sub), notDeleted(users.deletedAt)),
    })

    if (!user) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    // 校验用户未被禁用（与 login 保持一致，防止封禁用户通过 refresh 持续续期）
    if (user.status === false) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.USER_DISABLED])
    }

    // 首登未改密用户拒绝续期，强制重新登录改密
    if (user.mustChangePassword) {
      throw new UnauthorizedException('请先修改默认密码')
    }

    const tokens = await this.signTokenPair({
      sub: user.id,
      username: user.username,
      email: user.email,
      roleId: user.roleId,
      mustChangePassword: user.mustChangePassword,
    })

    await this.storeRefreshTokenForExternal(tokens.refreshToken, user.id)

    return tokens
  }

  async logout(userId: number): Promise<{ message: string }> {
    await this.redisService.deleteByPattern(`refresh:${userId}:*`)
    // 批量吊销全部活跃 access token（多设备/refresh 轮换后遗留的旧 token 一并拉黑，TTL=15min 与 token 有效期一致）
    await this.revokeAllAccessTokens(userId)

    return { message: '退出登录成功' }
  }

  /**
   * 批量吊销用户活跃 access token：读活跃 jti → 写黑名单 → 清活跃记录
   * 与 UsersService.revokeAccessTokens 逻辑一致，内联以避免模块循环依赖
   */
  private async revokeAllAccessTokens(userId: number): Promise<void> {
    const activeKeys = await this.redisService.scanKeys(`access:active:${userId}:*`)
    if (activeKeys.length === 0) return
    const prefix = `access:active:${userId}:`
    for (const key of activeKeys) {
      const jti = key.slice(prefix.length)
      await this.redisService.set(`access:${userId}:${jti}`, '1', 15 * 60)
    }
    await this.redisService.deleteByPattern(`access:active:${userId}:*`)
  }

  async getProfile(userId: number): Promise<
    Omit<User, 'password'> & {
      permissions: string[]
      roles: RoleBrief[]
    }
  > {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), notDeleted(users.deletedAt)),
    })

    if (!user) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    const permissions = await this.getPermissionsByUserId(userId)
    const role = await this.getRoleByUserId(userId)
    const { password: _, ...userWithoutPassword } = user
    return { ...userWithoutPassword, permissions, roles: role ? [role] : [] }
  }

  async register(
    username: string,
    email: string,
    password: string,
    nickname?: string,
  ): Promise<Omit<User, 'password'>> {
    const existingUser = await db.query.users.findFirst({
      where: and(eq(users.username, username), notDeleted(users.deletedAt)),
    })

    if (existingUser) {
      throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
    }

    const existingEmail = await db.query.users.findFirst({
      where: and(eq(users.email, email), notDeleted(users.deletedAt)),
    })

    if (existingEmail) {
      throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
    }

    const userRole = await db.query.roles.findFirst({
      where: and(eq(roles.name, 'user'), notDeleted(roles.deletedAt)),
    })

    if (!userRole) {
      throw new ConflictException('系统未初始化 user 角色，请联系管理员运行 pnpm db:seed')
    }

    const hashedPassword = await argon2.hash(password)

    try {
      const [newUser] = await db
        .insert(users)
        .values({
          username,
          email,
          password: hashedPassword,
          nickname,
          roleId: userRole.id,
        })
        .returning()

      if (!newUser) {
        throw new ConflictException(ErrorMessages[ErrorCodes.OPERATION_FAILED])
      }

      const { password: _, ...userWithoutPassword } = newUser
      return userWithoutPassword
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
      }
      throw error
    }
  }

  /**
   * 发送注册验证码
   * 同一邮箱 60 秒内不能重复发送
   */
  async sendRegisterCode(email: string): Promise<{ message: string }> {
    const existingEmail = await db.query.users.findFirst({
      where: and(eq(users.email, email), notDeleted(users.deletedAt)),
    })

    if (existingEmail) {
      // 防邮箱枚举：已注册邮箱返回与未注册一致的响应（与 login 防枚举策略对齐），不实际发送
      this.logger.warn(`注册验证码请求命中已注册邮箱，静默跳过发送: ${email}`)
      return { message: '验证码已发送' }
    }

    const lastSendTime = await this.redisService.get(`register:code:limit:${email}`)
    if (lastSendTime) {
      throw new ConflictException('验证码发送过于频繁，请 60 秒后重试')
    }

    const code = randomInt(0, 999999).toString().padStart(6, '0')
    const expiresIn = 5 * 60

    await this.redisService.set(`register:code:${email}`, code, expiresIn)
    await this.redisService.set(`register:code:limit:${email}`, '1', 60)

    // 发送邮件（传入 auth 生成的 code，确保与 Redis 存储一致）
    await this.mailService.sendVerificationCode(email, '注册用户', code)

    this.logger.log(`注册验证码已发送: ${email}`)
    return { message: '验证码已发送' }
  }

  async registerWithCode(
    username: string,
    email: string,
    password: string,
    code: string,
  ): Promise<TokenPair & { user: Omit<User, 'password'> }> {
    const storedCode = await this.redisService.get(`register:code:${email}`)
    if (!storedCode || storedCode !== code) {
      // 验证码尝试次数限制：5 次失败后删除验证码并重置计数，攻击者需重新获取（受 60s 发送限制）
      // Lua 保证 INCR + 首次 EXPIRE 原子，避免进程在两步之间崩溃导致计数永驻
      const attemptKey = `register:code:attempts:${email}`
      const attempts = (await this.redisService.eval(
        `local n = redis.call('INCR', KEYS[1])
         if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return n`,
        [attemptKey],
        [300],
      )) as number
      if (attempts >= 5) {
        await this.redisService.del(`register:code:${email}`)
        await this.redisService.del(attemptKey)
        throw new UnauthorizedException('验证码错误次数过多，请重新获取')
      }
      throw new UnauthorizedException('验证码无效或已过期')
    }

    // 验证成功即原子消费验证码（getdel）：否则注册失败后可换用户名反复尝试注册（同一码 5 分钟内多次使用）
    await this.redisService.getdel(`register:code:${email}`)
    await this.redisService.del(`register:code:attempts:${email}`)

    await this.register(username, email, password)

    return this.login(username, password)
  }

  /**
   * 签发访问/刷新令牌对。公开供第三方登录（如微信）复用。
   */
  async signTokenPair(payload: TokenPayload): Promise<TokenPair> {
    const accessTokenSecret = this.configService.get<string>('JWT_SECRET')
    const refreshTokenSecret = this.configService.get<string>('JWT_REFRESH_SECRET')

    const accessJti = randomUUID()
    const refreshJti = randomUUID()

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, jti: accessJti },
        {
          secret: accessTokenSecret,
          expiresIn: '15m',
        },
      ),
      this.jwtService.signAsync(
        { ...payload, jti: refreshJti },
        {
          secret: refreshTokenSecret,
          expiresIn: '7d',
        },
      ),
    ])

    // 记录活跃 access jti，供禁用/改角色/改密/删用户时批量吊销
    await this.redisService.set(`access:active:${payload.sub}:${accessJti}`, '1', 15 * 60)

    return { accessToken, refreshToken }
  }

  /**
   * 存储 refreshToken 到 Redis: key=refresh:{userId}:{jti}, value=1, TTL=7d
   */
  async storeRefreshTokenForExternal(token: string, userId: number): Promise<void> {
    try {
      const decoded = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
        ignoreExpiration: true,
      })
      const jti = (decoded as { jti?: string }).jti
      if (jti) {
        await this.redisService.set(`refresh:${userId}:${jti}`, '1', REFRESH_TOKEN_TTL)
      }
    } catch (err) {
      this.logger.error('存储 refreshToken 到 Redis 失败:', err)
      throw new ServiceUnavailableException('存储 refreshToken 失败')
    }
  }

  private async getPermissionsByUserId(userId: number): Promise<string[]> {
    const userRecord = await db.query.users.findFirst({
      where: and(eq(users.id, userId), notDeleted(users.deletedAt)),
    })
    if (!userRecord?.roleId) return []

    const role = await db.query.roles.findFirst({
      where: eq(roles.id, userRecord.roleId),
    })
    if (!role || role.deletedAt) return []

    const perms = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .innerJoin(
        permissions,
        and(eq(rolePermissions.permission, permissions.code), notDeleted(permissions.deletedAt)),
      )
      .where(eq(rolePermissions.roleId, userRecord.roleId))

    return perms.map((p) => p.permission)
  }

  private async getRoleByUserId(userId: number): Promise<RoleBrief | null> {
    const userRecord = await db.query.users.findFirst({
      where: and(eq(users.id, userId), notDeleted(users.deletedAt)),
    })
    if (!userRecord?.roleId) return null

    const role = await db.query.roles.findFirst({
      where: and(eq(roles.id, userRecord.roleId), notDeleted(roles.deletedAt)),
    })
    return role ? { id: role.id, name: role.name, description: role.description ?? null } : null
  }
}
