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
import { SkipThrottle } from '@nestjs/throttler'
import { PermissionCodes } from '@shared/constants/permissions'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { NotificationsService } from '@/modules/notifications/notifications.service'
import { NotifyDto } from './dto/notify.dto'
import { EventsService } from './events.service'

@ApiTags('WebSocket')
@ApiBearerAuth()
@Controller('websocket')
@UseGuards(PermissionsGuard)
export class WebsocketController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @SkipThrottle()
  @Get('online')
  @Permissions(PermissionCodes.NOTIFICATION_VIEW)
  @ApiOperation({ summary: '获取在线用户 ID 列表' })
  async online() {
    const userIds = await this.eventsService.getOnlineUserIds()
    return { count: userIds.length, userIds }
  }

  @SkipThrottle()
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
  async notify(@Body() dto: NotifyDto, @CurrentUser() user: TokenPayload) {
    // 自我校验：只能给自己发通知
    if (dto.userId !== user.sub) {
      throw new ForbiddenException('只能给自己发送通知')
    }
    const created = await this.notificationsService.create({
      userId: dto.userId,
      type: dto.type,
      title: dto.title,
      content: dto.content,
    })
    return {
      message: '通知已发送',
      notification: created,
      delivered: await this.eventsService.isUserOnline(dto.userId),
    }
  }
}
