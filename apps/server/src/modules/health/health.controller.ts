import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { OptionalAuth } from '@/common/decorators/optional-auth.decorator'
import { Public } from '@/common/decorators/public.decorator'
import { isAdminUser } from '@/common/utils/is-admin'
import { getEnv } from '@/config/env'
import { HealthService } from './health.service'

interface AuthRequest {
  user?: { sub: number; username: string; roleId: number | null }
}

@ApiTags('Health')
@Controller('health')
@Public()
// L11：公开 + 可选鉴权——无/无效 token 仍匿名可访问，有效 token 才用于裁剪详情
@OptionalAuth()
// L5：原 @SkipThrottle 使公开健康检查成为无限探测/放大入口；
// 60/min 仍远高于 docker healthcheck（30s 间隔 = 2/min）
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '健康检查' })
  @ApiResponse({ status: 200, description: '服务正常' })
  @ApiResponse({ status: 503, description: '服务异常' })
  async check(@Req() req: AuthRequest) {
    const result = await this.healthService.check()
    if (result.status === 'error') {
      throw new ServiceUnavailableException(result)
    }
    // L34：DB/Redis 连接细节（延迟/版本）是内部信息，仅超管可见——
    // 未认证与普通登录用户只返回基础状态（原先是"登录即可看全部"）
    if (!isAdminUser(req.user)) {
      // M3：e2e 指纹随基础状态一并匿名回显（仅显式注入时才出现），
      // 供 e2e global-setup 判定 9000 端口是否为本次测试实例
      const e2eMarker = getEnv().E2E_MARKER
      return {
        status: result.status,
        timestamp: result.timestamp,
        ...(e2eMarker ? { e2eMarker } : {}),
      }
    }
    return result
  }
}
