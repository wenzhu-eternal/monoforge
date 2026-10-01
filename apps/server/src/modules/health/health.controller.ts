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
import { isAdminUser } from '@/common/utils/is-admin'
import { HealthService } from './health.service'

interface AuthRequest {
  user?: { sub: number; username: string; email: string; roleId: number | null }
}

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
    // L34：DB/Redis 连接细节（延迟/版本）是内部信息，仅超管可见——
    // 未认证与普通登录用户只返回基础状态（原先是"登录即可看全部"）
    if (!isAdminUser(req.user)) {
      return { status: result.status, timestamp: result.timestamp }
    }
    return result
  }
}
