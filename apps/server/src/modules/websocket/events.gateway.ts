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
import type { Server, Socket } from 'socket.io'

/**
 * WebSocket 网关: 在线状态登记 + 通知推送
 * 鉴权: 从 auth.token（JWT access token）解析 userId
 */
@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      const allowed = process.env.ALLOW_ORIGIN
      if (!origin || !allowed || origin === allowed) {
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

  // userId -> Set<socketId> 在线连接映射（同一用户可多端在线）
  private readonly onlineUsers = new Map<number, Set<string>>()

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    const userId = this.extractUserId(client)
    if (!userId) {
      client.emit('error', { message: '未认证，连接被拒绝' })
      client.disconnect()
      return
    }

    const wasOnline = this.isUserOnline(userId)
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set())
    }
    this.onlineUsers.get(userId)!.add(client.id)
    client.data.userId = userId

    this.logger.log(`用户 ${userId} 已连接 (socket: ${client.id})`)

    // 新用户上线（之前不在线）才广播，避免多端重复广播
    if (!wasOnline) {
      this.pushAll('presence:update', { userId, online: true })
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as number | undefined
    if (!userId) return

    const sockets = this.onlineUsers.get(userId)
    if (sockets) {
      sockets.delete(client.id)
      if (sockets.size === 0) {
        this.onlineUsers.delete(userId)
        // 用户所有连接都断开才广播离线
        this.pushAll('presence:update', { userId, online: false })
      }
    }

    this.logger.log(`用户 ${userId} 已断开 (socket: ${client.id})`)
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: unknown): { event: string; data: unknown } {
    return { event: 'pong', data }
  }

  /**
   * 标记通知已读（客户端 emit 'notification:read' { id }）
   */
  @SubscribeMessage('notification:read')
  handleNotificationRead(@MessageBody() data: { id?: number }): {
    event: string
    data: { ok: boolean }
  } {
    // 实际持久化由 NotificationsService 负责（前端通过 HTTP 调用）
    return { event: 'notification:read:ack', data: { ok: !!data?.id } }
  }

  pushToUser(userId: number, event: string, data: unknown): void {
    const sockets = this.onlineUsers.get(userId)
    if (!sockets || sockets.size === 0) return

    for (const socketId of sockets) {
      this.server.to(socketId).emit(event, data)
    }
  }

  pushAll(event: string, data: unknown): void {
    this.server.emit(event, data)
  }

  getOnlineUserIds(): number[] {
    return Array.from(this.onlineUsers.keys())
  }

  isUserOnline(userId: number): boolean {
    const sockets = this.onlineUsers.get(userId)
    return !!sockets && sockets.size > 0
  }

  /**
   * 从握手 auth.token（JWT）解析 userId
   * 兼容 query.userId（仅当未配置 JWT 时降级，便于开发调试）
   */
  private extractUserId(client: Socket): number | null {
    const authToken = (client.handshake.auth as { token?: string } | undefined)?.token
    if (authToken) {
      try {
        const secret = this.configService.get<string>('JWT_SECRET')
        const payload = this.jwtService.verify<{ sub: number }>(authToken, { secret })
        if (payload?.sub && payload.sub > 0) {
          return payload.sub
        }
      } catch (err) {
        this.logger.warn(`WebSocket 鉴权失败: ${(err as Error).message}`)
        return null
      }
    }

    return null
  }
}
