import { randomInt, randomUUID } from 'node:crypto'
import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
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
    let payload: { sub: number; username: string; email: string; jti?: string }
    try {
      const secret = this.configService.get<string>('JWT_REFRESH_SECRET')
      payload = await this.jwtService.verifyAsync(refreshToken, { secret })
    } catch {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.REFRESH_TOKEN_INVALID])
    }

    // 校验 Redis 中存在该 token（已 logout 则不存在，实现真正吊销）
    const stored = await this.redisService.get(`refresh:${payload.sub}:${payload.jti}`)
    if (stored !== '1') {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_TOKEN])
    }

    const user = await db.query.users.findFirst({
      where: and(eq(users.id, payload.sub), notDeleted(users.deletedAt)),
    })

    if (!user) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.USER_NOT_FOUND])
    }

    // 旧 token 立即作废（防重放）
    await this.redisService.del(`refresh:${payload.sub}:${payload.jti}`)

    const tokens = await this.signTokenPair({
      sub: user.id,
      username: user.username,
      email: user.email,
    })

    await this.storeRefreshTokenForExternal(tokens.refreshToken, user.id)

    return tokens
  }

  // cookie 拿不到 jti，删除该用户全部 refresh token
  async logout(userId: number): Promise<{ message: string }> {
    await this.redisService.deleteByPattern(`refresh:${userId}:*`)
    return { message: '退出登录成功' }
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
      throw new ConflictException('该邮箱已被注册')
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
      throw new UnauthorizedException('验证码无效或已过期')
    }

    await this.register(username, email, password)

    // 注册成功后才删除验证码，避免注册失败导致验证码白费
    await this.redisService.del(`register:code:${email}`)

    return this.login(username, password)
  }

  /**
   * 签发访问/刷新令牌对。公开供第三方登录（如微信）复用。
   */
  async signTokenPair(payload: TokenPayload): Promise<TokenPair> {
    const accessTokenSecret = this.configService.get<string>('JWT_SECRET')
    const refreshTokenSecret = this.configService.get<string>('JWT_REFRESH_SECRET')

    // 为 refreshToken 增加 jti（唯一 ID），便于 Redis 单条吊销
    const jti = randomUUID()

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessTokenSecret,
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(
        { ...payload, jti },
        {
          secret: refreshTokenSecret,
          expiresIn: '7d',
        },
      ),
    ])

    return { accessToken, refreshToken }
  }

  /**
   * 存储 refreshToken 到 Redis: key=refresh:{userId}:{jti}, value=1, TTL=7d
   * 公开供第三方登录（如微信）复用。
   */
  async storeRefreshTokenForExternal(token: string, userId: number): Promise<void> {
    try {
      const decoded = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        ignoreExpiration: true,
      })
      const jti = (decoded as { jti?: string }).jti
      if (jti) {
        await this.redisService.set(`refresh:${userId}:${jti}`, '1', REFRESH_TOKEN_TTL)
      }
    } catch (err) {
      this.logger.error('存储 refreshToken 到 Redis 失败:', err)
    }
  }

  private async getPermissionsByUserId(userId: number): Promise<string[]> {
    const userRecord = await db.query.users.findFirst({
      where: and(eq(users.id, userId), notDeleted(users.deletedAt)),
    })
    if (!userRecord?.roleId) return []

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
