import { ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'
import type { Server } from 'socket.io'

/**
 * WebSocket Redis 适配器：多实例部署下通过 Redis pub/sub 同步 WS 事件
 * 同步 Socket.IO 事件层（server.emit/server.to）跨实例；业务层在线状态通过 Redis Set 维护
 */
export class RedisIoAdapter extends IoAdapter {
  private pubClient: Redis
  private subClient: Redis

  constructor(app: NestExpressApplication) {
    super(app)
    const configService = app.get(ConfigService)
    const redisUrl = configService.get<string>('REDIS_URL')
    if (!redisUrl) {
      throw new Error('REDIS_URL 未配置，无法初始化 WebSocket Redis 适配器')
    }
    this.pubClient = new Redis(redisUrl, { maxRetriesPerRequest: 3 })
    this.subClient = this.pubClient.duplicate()
    // ioredis 未监听 error 事件时错误冒泡为 unhandledError
    this.pubClient.on('error', () => undefined)
    this.subClient.on('error', () => undefined)
  }

  createIOServer(port: number, options?: Record<string, unknown>) {
    const server = super.createIOServer(port, options)
    server.adapter(createAdapter(this.pubClient, this.subClient))
    return server
  }

  // 应用关闭（app.close，含 shutdown hooks）时优雅断开 Redis 连接，避免连接泄漏
  async close(server: Server): Promise<void> {
    await super.close(server)
    this.pubClient.disconnect()
    this.subClient.disconnect()
  }
}
