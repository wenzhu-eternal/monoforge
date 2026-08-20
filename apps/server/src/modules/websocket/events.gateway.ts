import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { and, eq } from 'drizzle-orm'
import type { Server, Socket } from 'socket.io'
import { isAdminUser } from '@/common/utils/is-admin'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { rolePermissions, users } from '@/db/schema'
import { RedisService } from '@/modules/redis/redis.service'

// 单用户最大 WS 连接数，防 DoS
const MAX_CONNECTIONS_PER_USER = 5

// presence 事件接收方 room：持 notification:view 权限（或 admin）的连接加入；
// 广播走 server.to(room)，经 Redis adapter 跨实例投递，替代原"遍历本实例连接"的单实例过滤
const PRESENCE_ROOM = 'presence:watchers'

/**
 * WebSocket 网关: 在线状态登记 + 通知推送
 * 鉴权: 从 auth.token（JWT access token）解析 userId
 * 多实例: 通过 Redis Set 维护全局在线状态，pushToUser 跨实例可达
 * TTL: 在线状态 key TTL 300s，60s 定时重校验时续期，长连接期间不过期
 */
@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      const raw = process.env.ALLOW_ORIGIN
      if (!raw) {
        // 未配置时拒绝跨域（与 HTTP CORS 一致），避免放行所有来源
        callback(new Error('CORS not configured'))
        return
      }
      const allowed = raw.split(',').map((s) => s.trim())
      if (!origin || allowed.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
    credentials: true,
  },
  // 主动心跳探测：10s ping 一次，5s 没收到 pong 判定断开
  // 默认 25s+20s=45s 太慢，用户离线感知延迟过长
  pingInterval: 10_000,
  pingTimeout: 5_000,
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server

  private readonly logger = new Logger(EventsGateway.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    const auth = await this.extractAuth(client)
    if (!auth) {
      client.emit('error', { message: '未认证，连接被拒绝' })
      client.disconnect()
      return
    }

    const { userId, jti } = auth

    // 原子登记（Lua 保证 SCARD 判断 + SADD + TTL 续期无竞态）:
    // 返回 -1 表示连接数超限；否则返回登记后的全局连接数（含本次）
    let connCount: number
    try {
      connCount = (await this.redisService.eval(
        `local n = redis.call('SCARD', KEYS[1])
         if n >= tonumber(ARGV[2]) then return -1 end
         redis.call('SADD', KEYS[1], ARGV[1])
         redis.call('EXPIRE', KEYS[1], ARGV[3])
         return n + 1`,
        [`ws:online:${userId}`],
        [client.id, MAX_CONNECTIONS_PER_USER, 300],
      )) as number
    } catch (err) {
      // Redis 异常时不留本地残留，直接拒绝连接（避免 onlineUsers 与 Redis 不一致）
      this.logger.error(`WebSocket 在线状态登记失败 user=${userId}: ${(err as Error).message}`)
      client.emit('error', { message: '服务暂不可用，请稍后重试' })
      client.disconnect()
      return
    }
    if (connCount < 0) {
      client.emit('error', { message: '连接数超限，请先关闭其他设备' })
      client.disconnect()
      return
    }
    // 登记前数量为 0 说明之前全局不在线（用原子脚本返回值推导，消除原 wasOnline 查询竞态）
    const wasOnline = connCount > 1

    client.data.userId = userId
    client.data.jti = jti
    // 加载权限与角色到 socket（并按权限加入 presence room；同时校验用户状态，禁用/软删则拒绝连接）
    const ok = await this.loadUserPermissions(client, userId)
    if (!ok) {
      client.emit('error', { message: '账号不可用，连接被拒绝' })
      client.disconnect()
      return
    }

    this.logger.log(`用户 ${userId} 已连接 (socket: ${client.id})`)

    // 新用户上线（之前全局不在线）才广播，避免多端重复广播
    // presence 仅推给 presence room 内持 notification:view 的连接，避免泄露全员在线状态
    if (!wasOnline) {
      this.broadcastPresence('presence:update', { userId, online: true })
    }

    // 定时重校验（60s）: jti 黑名单（logout 后断开）+ 用户状态/权限；并续期在线状态 TTL，
    // 防止长连接超过 TTL 300s 后 key 过期导致 pushToUser 不可达
    const refreshTimer = setInterval(async () => {
      try {
        if (jti) {
          const revoked = await this.redisService.get(`access:${userId}:${jti}`)
          if (revoked === '1') {
            client.emit('error', { message: '登录状态已失效，连接被断开' })
            client.disconnect()
            return
          }
        }
        const stillOk = await this.loadUserPermissions(client, userId)
        if (!stillOk) {
          client.emit('error', { message: '账号状态已变更，连接被断开' })
          client.disconnect()
          return
        }
        await this.refreshOnlineTtl(userId)
      } catch (err) {
        // Redis/DB 抖动不踢连接，等待下一轮重试
        this.logger.warn(`WebSocket 定时重校验异常 user=${userId}: ${(err as Error).message}`)
      }
    }, 60_000)
    client.data.refreshTimer = refreshTimer
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as number | undefined
    // 清除定时重校验定时器，避免断开后继续触发
    if (client.data.refreshTimer) {
      clearInterval(client.data.refreshTimer as NodeJS.Timeout)
    }
    if (!userId) return

    // 全局清除（Redis Set），脚本返回剩余连接数；为 0 即全部断开，广播离线
    // （用脚本返回值判断，避免 SREM 未完成时二次 SCARD 读到旧值误判在线）
    this.redisService
      .eval(
        `redis.call('SREM', KEYS[1], ARGV[1])
         local n = redis.call('SCARD', KEYS[1])
         if n == 0 then redis.call('DEL', KEYS[1]) end
         return n`,
        [`ws:online:${userId}`],
        [client.id],
      )
      .then((remaining) => {
        if (Number(remaining) === 0) {
          this.broadcastPresence('presence:update', { userId, online: false })
        }
      })
      .catch((err) => this.logger.warn(`清除 Redis 在线状态失败: ${(err as Error).message}`))

    this.logger.log(`用户 ${userId} 已断开 (socket: ${client.id})`)
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: unknown): { event: string; data: unknown } {
    return { event: 'pong', data }
  }

  /**
   * 通知已读 ack（客户端 emit 'notification:read' { id }，实际持久化由 NotificationsService 负责）
   */
  @SubscribeMessage('notification:read')
  handleNotificationRead(@MessageBody() data: { id?: number }): {
    event: string
    data: { ok: boolean }
  } {
    // 实际持久化由 NotificationsService 负责（前端通过 HTTP 调用）
    return { event: 'notification:read:ack', data: { ok: !!data?.id } }
  }

  /**
   * 推送给指定用户：从 Redis Set 查全局 socketId，通过 Redis 适配器跨实例投递
   */
  async pushToUser(userId: number, event: string, data: unknown): Promise<void> {
    const socketIds = (await this.redisService.eval(
      `return redis.call('SMEMBERS', KEYS[1])`,
      [`ws:online:${userId}`],
      [],
    )) as string[]
    if (!socketIds || socketIds.length === 0) return
    for (const socketId of socketIds) {
      this.server.to(socketId).emit(event, data)
    }
  }

  pushAll(event: string, data: unknown): void {
    this.server.emit(event, data)
  }

  /**
   * presence 事件广播：仅 presence room 内连接可收到（持 notification:view 或 admin，见 syncPresenceRoom），
   * 避免向无权限用户泄露全员在线状态
   */
  private broadcastPresence(event: string, data: unknown): void {
    this.server.to(PRESENCE_ROOM).emit(event, data)
  }

  /**
   * 获取全局在线用户 ID 列表（扫描 Redis ws:online:* keys）
   */
  async getOnlineUserIds(): Promise<number[]> {
    const keys = await this.redisService.scanKeys('ws:online:*')
    return keys.map((k) => Number.parseInt(k.split(':').pop() ?? '0', 10)).filter((n) => n > 0)
  }

  /**
   * 查询用户是否在线（全局，基于 Redis Set）
   */
  async isUserOnline(userId: number): Promise<boolean> {
    const count = await this.getUserConnectionCount(userId)
    return count > 0
  }

  /**
   * 查询用户全局连接数（Redis Set SCARD）
   */
  private async getUserConnectionCount(userId: number): Promise<number> {
    const count = (await this.redisService.eval(
      `return redis.call('SCARD', KEYS[1])`,
      [`ws:online:${userId}`],
      [],
    )) as number
    return count
  }

  /**
   * 续期在线状态 TTL（60s 定时重校验时调用，保证长连接期间 key 不过期）
   */
  private async refreshOnlineTtl(userId: number): Promise<void> {
    await this.redisService.eval(
      `redis.call('EXPIRE', KEYS[1], ARGV[1])`,
      [`ws:online:${userId}`],
      [300],
    )
  }

  /**
   * 从握手 auth.token（JWT）解析 userId + username，并校验 jti 黑名单
   */
  private async extractAuth(client: Socket): Promise<{
    userId: number
    username: string
    jti?: string
    mustChangePassword?: boolean
  } | null> {
    const authToken = (client.handshake.auth as { token?: string } | undefined)?.token
    if (!authToken) return null
    try {
      const secret = this.configService.get<string>('JWT_SECRET')
      const payload = await this.jwtService.verifyAsync<{
        sub: number
        username: string
        jti?: string
        mustChangePassword?: boolean
      }>(authToken, { secret, algorithms: ['HS256'] })
      if (!payload?.sub || payload.sub <= 0) return null
      // 查 jti 黑名单（与 AuthGuard 一致：access:${sub}:${jti}）
      if (payload.jti) {
        const revoked = await this.redisService.get(`access:${payload.sub}:${payload.jti}`)
        if (revoked === '1') {
          this.logger.warn(`WebSocket 拒绝已吊销的 token: user=${payload.sub}`)
          return null
        }
      }
      // 强制改密场景：拒绝建立 WS 连接（与 HTTP 链路 auth.guard.ts 行为一致）
      if (payload.mustChangePassword) {
        this.logger.warn(`WebSocket 拒绝需强制改密用户: user=${payload.sub}`)
        return null
      }
      return { userId: payload.sub, username: payload.username, jti: payload.jti }
    } catch (err) {
      this.logger.warn(`WebSocket 鉴权失败: ${(err as Error).message}`)
      return null
    }
  }

  /**
   * 查询用户权限码并缓存 roleId 到 socket，并按权限维护 presence room 成员资格
   * admin 由 roleId 判断（与后端 isAdminUser 一致），无需查权限码
   * 简化版查询（不 join permissions 过滤已删权限、不走 Redis 缓存；注：与 PermissionsGuard 不一致，待对齐）
   * 返回 false 表示用户被禁用或软删，调用方应断开连接；DB 异常时返回 false 避免虚假在线
   */
  private async loadUserPermissions(client: Socket, userId: number): Promise<boolean> {
    try {
      const userRecord = await db.query.users.findFirst({
        where: and(eq(users.id, userId), eq(users.status, true), notDeleted(users.deletedAt)),
      })
      if (!userRecord) {
        // 用户被禁用或软删，拒绝连接
        return false
      }
      client.data.roleId = userRecord.roleId
      // admin 直通，无需查权限码（实际由 isAdmin 标志判断）
      if (!userRecord.roleId || isAdminUser(userRecord)) {
        client.data.permissions = []
        // 仅 admin role 置 true，无角色用户保持 false，避免越权
        client.data.isAdmin = isAdminUser(userRecord)
        this.syncPresenceRoom(client)
        return true
      }
      const perms = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, userRecord.roleId))
      client.data.permissions = perms.map((p) => p.permission)
      client.data.isAdmin = false
      this.syncPresenceRoom(client)
      return true
    } catch (err) {
      // DB 异常时返回 false 触发断连，避免 client 已加入 presence room 但 permissions 未设置的虚假在线
      this.logger.error(`WebSocket 加载用户权限失败 user=${userId}: ${(err as Error).message}`)
      return false
    }
  }

  /**
   * 按当前权限同步 presence room 成员资格（连接时与 60s 重校验时调用，
   * 权限被收回的连接在下一个重校验周期内自动退出 room）
   */
  private syncPresenceRoom(client: Socket): void {
    const perms = (client.data as { permissions?: string[] }).permissions ?? []
    const isAdmin = (client.data as { isAdmin?: boolean }).isAdmin === true
    if (isAdmin || perms.includes('notification:view')) {
      client.join(PRESENCE_ROOM)
    } else {
      client.leave(PRESENCE_ROOM)
    }
  }
}
