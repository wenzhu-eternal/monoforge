import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

/** per-user key 前缀：`refresh:<userId>:<jti>` / `access:active:<userId>:<jti>` */
interface UserPattern {
  prefix: string
  userId: string
}

/**
 * 解析 per-user 吊销模式 `prefix:<userId>:*`，非该形状返回 null（保持原 glob 语义）
 */
function parseUserPattern(pattern: string): UserPattern | null {
  const m = /^(refresh|access:active):(\d+):\*$/.exec(pattern)
  return m ? { prefix: m[1] as string, userId: m[2] as string } : null
}

/**
 * 精确段匹配：`refresh:1` 只接受 `refresh:1:<单段>`，拒绝 `refresh:10:...`
 */
function isExactUserKey(key: string, { prefix, userId }: UserPattern): boolean {
  const head = `${prefix}:${userId}:`
  if (!key.startsWith(head)) return false
  return !key.slice(head.length).includes(':')
}

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

  /**
   * SET NX EX 原子抢占（key 不存在才设置）：限流锁防 check-then-act 竞态
   * 返回 true=抢占成功，false=key 已存在
   */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX')
    return result === 'OK'
  }

  /**
   * 查询 key 剩余 TTL（秒）：-1 永久，-2 不存在。供限流返回真实剩余时间
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key)
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
   *
   * per-user 精确段过滤：Redis glob 的 `*` 跨 `:` 匹配，`refresh:1:*` 会同时命中
   * `refresh:10:*`。形如 `prefix:<userId>:*` 的模式在删除前必须过滤到精确段
   * （`prefix:<userId>:[^:]+`），否则 user 1 登出会误删 user 10/100 的 token。
   */
  async deleteByPattern(pattern: string): Promise<number> {
    const userPattern = parseUserPattern(pattern)
    let cursor = '0'
    let deleted = 0
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = next
      const targets = userPattern ? keys.filter((k) => isExactUserKey(k, userPattern)) : keys
      if (targets.length > 0) {
        await this.client.del(...targets)
        deleted += targets.length
      }
    } while (cursor !== '0')
    return deleted
  }

  /**
   * 扫描匹配模式的所有 key（用 SCAN 避免阻塞，仅读取不删除）
   * 供 access token 批量吊销等场景使用，同样做 per-user 精确段过滤
   * （否则截出的 jti 错位，黑名单写到无效 key 上）
   */
  async scanKeys(pattern: string): Promise<string[]> {
    const userPattern = parseUserPattern(pattern)
    let cursor = '0'
    const result: string[] = []
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = next
      result.push(...(userPattern ? keys.filter((k) => isExactUserKey(k, userPattern)) : keys))
    } while (cursor !== '0')
    return result
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
