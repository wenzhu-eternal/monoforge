import { randomInt, randomUUID } from 'node:crypto'
import {
  ConflictException,
  HttpException,
  HttpStatus,
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
import { normalizeIpForKey } from '@/common/utils/ip-normalize'
import { getEnv } from '@/config/env'
import { db } from '@/db'
import { isUniqueViolation, notDeleted } from '@/db/helpers'
import type { User } from '@/db/schema'
import { permissions, rolePermissions, roles, users } from '@/db/schema'
import { ErrorLogsService } from '@/modules/error-logs/error-logs.service'
import { MailService } from '@/modules/mail/mail.service'
import { RedisService } from '@/modules/redis/redis.service'

export interface TokenPayload {
  sub: number
  username: string
  // L8：不内嵌 email——鉴权链路用不到（/auth/me 已下发），token 经日志/错误上报泄露时
  // 不应带出 PII
  roleId: number | null
  mustChangePassword?: boolean
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60

/** M4：日志脱敏——保留首字符与域名，隐藏本地部分（防日志面明文邮箱） */
import { maskEmail } from '@/common/utils/mail-utils'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly errorLogsService: ErrorLogsService,
  ) {}

  // L1：登录防用户枚举——不存在/禁用与密码错误返回同一文案；不存在时仍做一次
  // dummy verify 拉平时序（否则响应耗时直接暴露用户名是否存在）
  // L2：账户级失败封顶 10 次/15min（IP 限流 5/min 可被代理池绕过，账户锁补位）
  private static readonly DUMMY_HASH =
    '$argon2id$v=19$m=65536,t=3,p=4$spADZX2IPkQojufmYn/DUA$8JJg6hKKTYvy9oEBcQuxynyW8KDX2WuCNUoAML23iwA'
  private static readonly LOGIN_FAIL_LIMIT = 10
  private static readonly LOGIN_FAIL_TTL = 15 * 60

  async login(
    username: string,
    password: string,
    // M2：锁定键含来源 IP——纯 username 全局计数下攻击者零成本（10 次/15min 无密码）
    // 即可锁死任意已知账号（含 admin）；ip+username 组合后只能锁"自己 IP 下的该用户"
    ip?: string,
  ): Promise<
    TokenPair & { user: Omit<User, 'password'> & { permissions: string[]; roles: RoleBrief[] } }
  > {
    await this.enforceLoginAttemptLimit(username, ip)

    const user = await db.query.users.findFirst({
      where: and(eq(users.username, username), notDeleted(users.deletedAt)),
    })

    if (!user) {
      await argon2.verify(AuthService.DUMMY_HASH, password).catch(() => false)
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_PASSWORD])
    }

    // 禁用状态与密码错误同文案：独立 USER_DISABLED 文案会直接确认用户存在
    if (user.status === false) {
      await argon2.verify(user.password, password).catch(() => false)
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_PASSWORD])
    }

    const isPasswordValid = await argon2.verify(user.password, password)
    if (!isPasswordValid) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_PASSWORD])
    }

    await this.clearLoginFailures(username, ip)

    const tokens = await this.signTokenPair({
      sub: user.id,
      username: user.username,
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

  /**
   * M2：登录失败按 ip+username 计数封顶（防零成本定向锁死任意账号，含 admin）。
   * L3：检查与计数合并为单次 Lua——旧实现先 GET 读后放行（check-then-act），并发错误
   * 密码全读到同一旧值，封顶退化为"10 个串行批次"；INCR+首带 EXPIRE 原子无计数竞态。
   * "尝试即计数"与原"失败才计数"等效：成功登录 clearLoginFailures 清零。
   * Redis 故障降级放行（登录是核心路径，不因缓存抖动锁死用户）；触发锁定打告警供追踪。
   */
  private async enforceLoginAttemptLimit(username: string, ip?: string): Promise<void> {
    try {
      const locked = Number(
        await this.redisService.eval(
          `local n = redis.call('INCR', KEYS[1])
           if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
           if n > tonumber(ARGV[2]) then return 1 end
           return 0`,
          [this.loginFailKey(username, ip)],
          [AuthService.LOGIN_FAIL_TTL, AuthService.LOGIN_FAIL_LIMIT],
        ),
      )
      if (locked === 1) {
        this.logger.warn(
          `登录锁定触发: user=${username} ip=${ip ?? 'unknown'}（15min 内 10 次失败）`,
        )
        throw new HttpException('登录失败次数过多，请 15 分钟后重试', HttpStatus.TOO_MANY_REQUESTS)
      }
    } catch (error) {
      // 锁定（HttpException）原样上抛；Redis 故障降级放行（此时无计数亦无锁）
      if (error instanceof HttpException) throw error
    }
  }

  /** M2：锁定键含来源 IP；无 IP 时退化为仅用户名（与旧行为一致，不放大口径） */
  // L3：入键前归一（/24 折叠）——与 throttler/audit/error-logs 同口径；原用原始 IP 时
  // IPv6 隐私地址逐请求变即换桶，10 次/15min 的账户封顶对旋转源近乎失效
  private loginFailKey(username: string, ip?: string): string {
    return ip ? `login:fail:${normalizeIpForKey(ip)}:${username}` : `login:fail:${username}`
  }

  private async clearLoginFailures(username: string, ip?: string): Promise<void> {
    try {
      await this.redisService.del(this.loginFailKey(username, ip))
    } catch {
      // 清理失败忽略，等待 TTL 过期
    }
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: {
      sub: number
      username: string
      roleId?: number | null
      jti?: string
      iat?: number
    }
    try {
      const secret = this.configService.get<string>('JWT_REFRESH_SECRET')
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret,
        // L1：验签锁死 HS256（防 alg 混淆；storeRefreshTokenForExternal 处已有同款）
        algorithms: ['HS256'],
      })
    } catch {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.REFRESH_TOKEN_INVALID])
    }

    // L7：登出失效时间戳早退——签发时间早于最近一次登出的 token 一律拒绝
    //（iat 为秒、时间戳为毫秒，按 iat 该秒末尾比较：同秒内重新登录的新 token 放行，
    // 严格比较会把"登出后同一秒登录"误判为吊销）
    const logoutAt = Number((await this.redisService.get(`logout:at:${payload.sub}`)) ?? 0)
    if (logoutAt > 0 && (payload.iat ?? 0) * 1000 + 999 < logoutAt) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_TOKEN])
    }

    // L2：先 GET 预检（不消耗），DB/状态校验通过后再 getdel 作废——
    // 原顺序先 getdel，DB 抖动抛 503 时旧 RT 已销毁且新 token 未返回，客户端被迫重登
    //（多端共享 RT 的部署下放大为一次全员强制重登）
    const refreshKey = `refresh:${payload.sub}:${payload.jti}`
    const storedPre = await this.redisService.get(refreshKey)
    if (storedPre !== '1') {
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
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.MUST_CHANGE_PASSWORD])
    }

    // 原子 getdel 复核并作废旧 token：并发重放时只有一个请求能拿到 '1'
    const stored = await this.redisService.getdel(refreshKey)
    if (stored !== '1') {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_TOKEN])
    }

    const tokens = await this.signTokenPair({
      sub: user.id,
      username: user.username,
      roleId: user.roleId,
      mustChangePassword: user.mustChangePassword,
    })

    await this.storeRefreshTokenForExternal(tokens.refreshToken, user.id)

    // L7：签发后复检——早退与落盘之间发生的登出拦不住（竞态设备 getdel 先于
    // deleteByPattern 完成、新 refresh 键晚于清理写入即存活）。令牌未出网关，
    // 直接作废不返回即可（孤儿键 7d 自然过期）
    const logoutAtFinal = Number((await this.redisService.get(`logout:at:${user.id}`)) ?? 0)
    if (logoutAtFinal > 0 && (payload.iat ?? 0) * 1000 + 999 < logoutAtFinal) {
      throw new UnauthorizedException(ErrorMessages[ErrorCodes.INVALID_TOKEN])
    }

    return tokens
  }

  async logout(userId: number): Promise<{ message: string }> {
    // L7：先落登出失效时间戳——refresh 的 getdel 若先于 deleteByPattern 完成，竞态设备
    // 会在清理之后签发存活 7d 的新令牌；时间戳供 refresh 早退 + 签发后复检判定作废。
    // TTL 盖过 refresh 存续期（7d + 1d 余量）
    // M2：三段吊销独立重试+留痕——原单 try 下首段 logout:at 抖动会让 refresh 批删与 AT 拉黑
    // 整段跳过，Redis 恢复后旧 RT 可续命最长 7d 且零留痕（对照 changePassword 的三段收口）
    await this.retryAndRecord(
      () =>
        this.redisService.set(`logout:at:${userId}`, String(Date.now()), REFRESH_TOKEN_TTL + 86400),
      'logout:at 写入',
    )
    await this.retryAndRecord(
      () => this.redisService.deleteByPattern(`refresh:${userId}:*`),
      'refresh token 吊销',
    )
    // 批量吊销全部活跃 access token（多设备/refresh 轮换后遗留的旧 token 一并拉黑，TTL=15min 与 token 有效期一致）
    await this.retryAndRecord(() => this.revokeAllAccessTokens(userId), 'access token 拉黑')

    return { message: '退出登录成功' }
  }

  /** 单段重试一次，仍失败写 error_logs 留痕；留痕自身失败降级 logger（业务已成功不回滚） */
  private async retryAndRecord(fn: () => Promise<unknown>, what: string): Promise<void> {
    try {
      await fn()
    } catch {
      try {
        await fn()
      } catch (retryErr) {
        const message = `退出登录 ${what} 失败（重试后仍失败）: ${
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        }`
        try {
          await this.errorLogsService.record({ message, internal: true })
        } catch (recordErr) {
          this.logger.warn(
            `退出登录失败留痕写入失败: ${
              recordErr instanceof Error ? recordErr.message : String(recordErr)
            }`,
          )
        }
      }
    }
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
      adminRoleId: number
      isAdmin: boolean
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
    // L19：配置派生字段单源下发——adminRoleId 供前端行级判定初始管理员，isAdmin 判当前用户
    const { ADMIN_ROLE_ID } = getEnv()
    return {
      ...userWithoutPassword,
      permissions,
      roles: role ? [role] : [],
      adminRoleId: ADMIN_ROLE_ID,
      isAdmin: user.roleId != null && user.roleId === ADMIN_ROLE_ID,
    }
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
      where: and(eq(roles.id, getEnv().DEFAULT_USER_ROLE_ID), notDeleted(roles.deletedAt)),
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
    // M4：60s 抢锁先于已注册检查——原顺序下已注册恒 200、未注册第二次 409，
    // 响应差异完整泄露账号存在性（锁在早退路径也不释放，两条路径时序一致）
    const acquired = await this.redisService.setNx(`register:code:limit:${email}`, '1', 60)
    if (!acquired) {
      throw new ConflictException('验证码发送过于频繁，请 60 秒后重试')
    }

    const existingEmail = await db.query.users.findFirst({
      where: and(eq(users.email, email), notDeleted(users.deletedAt)),
    })

    // L1：已注册邮箱也写验证码、未注册邮箱也写验证码，与未注册路径耗时一致，防掐表枚举。
    // J1：已注册邮箱跳过真实投递（60s 锁 + 统一响应先于投递，跳过不泄露新信息，防出站邮件放大器）；
    // 邮件发送失败仅 warn，不影响主流程
    const code = randomInt(0, 999999).toString().padStart(6, '0')
    const expiresIn = 5 * 60
    await this.redisService.set(`register:code:${email}`, code, expiresIn)
    if (!existingEmail) {
      // 异步发信——不阻塞响应，失败仅告警
      this.mailService
        .sendVerificationCode(email, '注册用户', code)
        .catch((err) =>
          this.logger.warn(
            `注册验证码投递失败: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
    }
    this.logger.log(
      `注册验证码已生成: ${existingEmail ? '已注册' : '未注册'}邮箱 ${maskEmail(email)}`,
    )
    return { message: '验证码已发送' }
  }

  async registerWithCode(
    username: string,
    email: string,
    password: string,
    code: string,
    // Q9：透传注册来源 IP 给内部 login，失败计数键按 ip+username 收敛（不退回全局 username 键）
    ip?: string,
  ): Promise<TokenPair & { user: Omit<User, 'password'> }> {
    const codeKey = `register:code:${email}`
    // L11：先读剩余 TTL 再 getdel——getdel 后 key 已删除无从查询，原实现错码回填恒设满 5 分钟，
    // 等于每次输错都把验证码余量续满（配合 60s 取码锁可无限延长有效窗口）
    const remainingTtl = await this.redisService.ttl(codeKey)
    // L1：check-and-consume 必须单点原子——原"先 GET 判等、再 getdel 丢弃返回值"在并发下
    // 两个请求都能通过 GET，第二个 getdel 拿 null 却继续注册
    const consumed = await this.redisService.getdel(codeKey)
    if (!consumed || consumed !== code) {
      // 输入错误时回填：错码也会被 getdel 取走，回填避免一次输错烧毁有效验证码
      // L11：按剩余余量回填（-1 永久 / -2 不存在时退回原有效期）
      if (consumed) {
        await this.redisService.set(codeKey, consumed, remainingTtl > 0 ? remainingTtl : 5 * 60)
      }
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

    await this.redisService.del(`register:code:attempts:${email}`)

    try {
      await this.register(username, email, password)
    } catch (err) {
      // L7：注册冲突（用户名/邮箱已占用）时回写验证码，TTL 延用，用户无需等 60s 发送限制即可重试
      if (err instanceof ConflictException) {
        // 验证码原 TTL 为 5 分钟，此处等长重设，避免用户重新获取前受 60s 发送限制
        await this.redisService.set(`register:code:${email}`, code, 5 * 60)
      }
      throw err
    }

    return this.login(username, password, ip)
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
