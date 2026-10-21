import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PermissionCodes } from '@shared/constants/permissions'
import { AuditAction } from '@/common/decorators/audit.decorator'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { consumeDailyQuota, rollbackDailyQuota } from '@/common/utils/daily-quota'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { NotificationsService } from '@/modules/notifications/notifications.service'
import { RedisService } from '@/modules/redis/redis.service'
import { NotifyDto } from './dto/notify.dto'
import { EventsService } from './events.service'

// M13：通知日配额上限提为模块常量——原内联在 handler，运维无法从代码外快速定位
const NOTIFY_DAILY_LIMIT = 50

@ApiTags('WebSocket')
@ApiBearerAuth()
@Controller('websocket')
@UseGuards(PermissionsGuard)
export class WebsocketController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly notificationsService: NotificationsService,
    private readonly redisService: RedisService,
  ) {}

  @Get('online')
  @Permissions(PermissionCodes.NOTIFICATION_VIEW)
  @ApiOperation({ summary: '获取在线用户 ID 列表' })
  async online() {
    const userIds = await this.eventsService.getOnlineUserIds()
    return { count: userIds.length, userIds }
  }

  @Get('me')
  @ApiOperation({ summary: '查询当前用户是否在线' })
  async me(@CurrentUser() user: TokenPayload) {
    return {
      userId: user.sub,
      online: await this.eventsService.isUserOnline(user.sub),
    }
  }

  @Post('notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送测试通知（持久化 + 在线推送）' })
  @AuditAction('发送通知')
  // L4：通知日配额——防止登录用户以 ~1.4 万行/日可控灌满通知表
  async notify(@Body() dto: NotifyDto, @CurrentUser() user: TokenPayload) {
    // 自我校验：只能给自己发通知
    if (dto.userId !== user.sub) {
      throw new ForbiddenException('只能给自己发送通知')
    }
    // M13：日配额统一走 consumeDailyQuota——键口径 quota:notify:<uid>:<yyyymmdd> 与
    // SECURITY.md 承诺一致，超限抛 409（与 backup/upload 同族）；原手写实现键用连字符
    // 日期且抛 404，运维按文档查不到、配额触顶零观测
    await consumeDailyQuota(this.redisService, 'notify', user.sub, NOTIFY_DAILY_LIMIT)
    const created = await this.notificationsService
      .create({
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
      })
      .catch(async (err: unknown) => {
        // M13：create 失败退额——DB 抖动期重试否则可烧穿 50/日（对齐 manualBackup rollback）
        await rollbackDailyQuota(this.redisService, 'notify', user.sub).catch(() => {})
        throw err
      })
    // L6：isUserOnline 抛 Redis 错误不应让已发送的通知变 500 且不退额
    let delivered = false
    try {
      delivered = await this.eventsService.isUserOnline(dto.userId)
    } catch {
      delivered = false
    }
    return {
      message: '通知已发送',
      notification: created,
      delivered,
    }
  }
}
