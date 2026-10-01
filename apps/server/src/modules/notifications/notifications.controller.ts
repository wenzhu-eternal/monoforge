import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { NotificationSchema } from '@shared/schemas/notification'
import { PaginatedResponseSchema } from '@shared/schemas/pagination'
import { ZodSerializerDto } from 'nestjs-zod'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { isAdminUser } from '@/common/utils/is-admin'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { NotificationsService } from './notifications.service'

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: '分页拉取通知列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ZodSerializerDto(PaginatedResponseSchema(NotificationSchema))
  list(
    @CurrentUser() user: TokenPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    // 防御 NaN: 非数字字符串 parseInt 后为 NaN，直接抛 400 错误（与 users.controller 同款）
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    return this.notificationsService.list(
      user.sub,
      pageNum,
      size,
      unreadOnly === 'true',
      isAdminUser(user),
    )
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读通知数' })
  unreadCount(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.unreadCount(user.sub)
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '标记单条已读' })
  @ZodSerializerDto(NotificationSchema)
  markAsRead(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.notificationsService.markAsRead(user.sub, id)
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '标记全部已读' })
  markAllRead(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.markAllRead(user.sub)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除通知' })
  remove(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.notificationsService.remove(user.sub, id)
  }
}
