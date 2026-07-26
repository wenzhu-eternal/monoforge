import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '@/common/decorators/public.decorator'
import type { AuthRequest } from '@/common/types'
import { HealthService } from './health.service'

@ApiTags('Health')
@Controller('health')
@Public()
@SkipThrottle()
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
    // 未认证请求只返回 status，不暴露数据库/Redis 细节
    if (!req.user) {
      return { status: result.status, timestamp: result.timestamp }
    }
    return result
  }
}
