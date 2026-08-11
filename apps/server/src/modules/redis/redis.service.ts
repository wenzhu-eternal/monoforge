import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  private readonly client: Redis

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL')
    if (!redisUrl) {
      throw new Error('REDIS_URL 未配置')
    }
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    })
    this.client.on('error', (err) => {
      this.logger.error('连接错误:', err.message)
    })
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping()
      return res === 'PONG'
    } catch {
      return false
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds)
    } else {
      await this.client.set(key, value)
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  /**
   * 原子 get+del（Redis 6.2+），用于 refresh token 轮换防并发重放
   * 返回原值（不存在时为 null）
   */
  async getdel(key: string): Promise<string | null> {
    return this.client.getdel(key)
  }

  /**
   * 执行 Lua 脚本（原子操作），用于限流等需要多命令原子的场景
   */
  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...args)
  }

  async exists(key: string): Promise<boolean> {
    const r = await this.client.exists(key)
    return r === 1
  }

  // 原子自增（用于限流计数等场景）
  async incr(key: string): Promise<number> {
    return this.client.incr(key)
  }

  // 设置 key 过期时间（秒）
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const r = await this.client.expire(key, ttlSeconds)
    return r === 1
  }

  /**
   * 删除匹配模式的所有 key（用 SCAN 避免阻塞，禁用 KEYS）
   */
  async deleteByPattern(pattern: string): Promise<number> {
    let cursor = '0'
    let deleted = 0
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = next
      if (keys.length > 0) {
        await this.client.del(...keys)
        deleted += keys.length
      }
    } while (cursor !== '0')
    return deleted
  }

  /**
   * 扫描匹配模式的所有 key（用 SCAN 避免阻塞，仅读取不删除）
   * 供 access token 批量吊销等场景使用
   */
  async scanKeys(pattern: string): Promise<string[]> {
    let cursor = '0'
    const result: string[] = []
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = next
      result.push(...keys)
    } while (cursor !== '0')
    return result
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
