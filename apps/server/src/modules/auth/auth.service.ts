import { randomUUID } from 'node:crypto'
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import * as argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import type { User } from '@/db/schema'
import { rolePermissions, roles, users } from '@/db/schema'
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

// refreshToken TTL: 7 天（秒）
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async login(
    username: string,
    password: string,
  ): Promise<TokenPair & { user: Omit<User, 'password'> }> {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
    })

    if (!user) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_PASSWORD])
    }

    const isPasswordValid = await argon2.verify(user.password, password)
    if (!isPasswordValid) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_PASSWORD])
    }

    // 禁用用户禁止登录
    if (user.status === false) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.USER_DISABLED])
    }

    const tokens = await this.signTokenPair({
      sub: user.id,
      username: user.username,
      email: user.email,
    })

    // 把 refreshToken 的 jti 存入 Redis，用于吊销校验
    await this.storeRefreshTokenForExternal(tokens.refreshToken, user.id)

    const permissions = await this.getPermissionsByUserId(user.id)
    const role = await this.getRoleByUserId(user.id)
    const { password: _, ...userWithoutPassword } = user

    return {
      ...tokens,
      user: { ...userWithoutPassword, permissions, roles: role ? [role] : [] } as Omit<
        User,
        'password'
      > & {
        permissions: string[]
        roles: { id: number; name: string; description?: string }[]
      },
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
      where: eq(users.id, payload.sub),
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

  /**
   * 登出: 删除该用户的 refreshToken，实现真正吊销
   * 由于 cookie 中拿不到 jti，这里删除该用户全部 refresh token
   */
  async logout(userId: number): Promise<{ message: string }> {
    await this.redisService.deleteByPattern(`refresh:${userId}:*`)
    return { message: '退出登录成功' }
  }

  async getProfile(userId: number): Promise<
    Omit<User, 'password'> & {
      permissions: string[]
      roles: { id: number; name: string; description?: string }[]
    }
  > {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
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
      where: eq(users.username, username),
    })

    if (existingUser) {
      throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
    }

    const existingEmail = await db.query.users.findFirst({
      where: eq(users.email, email),
    })

    if (existingEmail) {
      throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
    }

    const hashedPassword = await argon2.hash(password)

    const [newUser] = await db
      .insert(users)
      .values({
        username,
        email,
        password: hashedPassword,
        nickname,
      })
      .returning()

    if (!newUser) {
      throw new ConflictException(ErrorMessages[ErrorCodes.OPERATION_FAILED])
    }

    const { password: _, ...userWithoutPassword } = newUser
    return userWithoutPassword
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
      console.error('[Auth] 存储 refreshToken 到 Redis 失败:', err)
    }
  }

  /**
   * 根据用户 ID 查询权限码列表
   * 通过 users.roleId → role_permissions.permission 获取
   */
  private async getPermissionsByUserId(userId: number): Promise<string[]> {
    const userRecord = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })
    if (!userRecord?.roleId) return []

    const perms = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, userRecord.roleId))

    return perms.map((p) => p.permission)
  }

  /**
   * 根据用户 ID 查询角色信息
   */
  private async getRoleByUserId(
    userId: number,
  ): Promise<{ id: number; name: string; description?: string } | null> {
    const userRecord = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })
    if (!userRecord?.roleId) return null

    const role = await db.query.roles.findFirst({
      where: eq(roles.id, userRecord.roleId),
    })
    return role
      ? { id: role.id, name: role.name, description: role.description ?? undefined }
      : null
  }
}
