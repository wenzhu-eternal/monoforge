import type { ConfigService } from '@nestjs/config'
import type { ThrottlerModuleOptions } from '@nestjs/throttler'
import type { RedisService } from '@/modules/redis/redis.service'
import { RedisThrottlerStorage } from './storage/redis-throttler.storage'

/**
 * M5：限流模块配置独立成纯函数，便于契约 spec 以 production env 驱动真实配置，
 * 防止 @Throttle 声明值 / named 桶 / test 旁路在未来静默回退。
 */
export function buildThrottlerOptions(
  configService: ConfigService,
  redisService: RedisService,
): ThrottlerModuleOptions {
  return {
    // L15①：显式 ALLOW_THROTTLE_BYPASS=true 才旁路（仅 e2e/vitest 测试环境设置），
    // 不再按 NODE_ENV=test 隐式旁路——测试/预发误用该值部署不会静默全无限流
    skipIf: () => configService.get<string>('ALLOW_THROTTLE_BYPASS') === 'true',
    throttlers: [
      {
        ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
        limit: configService.get<number>('THROTTLE_LIMIT', 60),
      },
    ],
    storage: new RedisThrottlerStorage(redisService),
  }
}
