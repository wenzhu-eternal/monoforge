import { Injectable } from '@nestjs/common'
import { RedisService } from '@/modules/redis/redis.service'

/** 缓存服务：基于 Redis */
@Injectable()
export class CacheService {
  constructor(private readonly redisService: RedisService) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redisService.get(key)
      if (!value) return null
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  async set<T>(key: string, value: T, ttl = 60): Promise<void> {
    try {
      await this.redisService.set(key, JSON.stringify(value), ttl)
    } catch {
      // 缓存写入失败不影响主流程
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redisService.del(key)
    } catch {
      // 缓存删除失败不影响主流程
    }
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttl = 60): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) {
      return cached
    }
    const value = await factory()
    await this.set(key, value, ttl)
    return value
  }
}
