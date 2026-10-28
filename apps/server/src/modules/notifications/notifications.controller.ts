import {
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
import { AUDIT_ACTIONS } from '@shared/constants'
import { NotificationSchema } from '@shared/schemas/notification'
import { PaginatedResponseSchema } from '@shared/schemas/pagination'
import { ZodSerializerDto } from 'nestjs-zod'
import { AuditAction } from '@/common/decorators/audit.decorator'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { parsePagination } from '@/common/utils/pagination'
import { parseBoolQuery } from '@/common/utils/parse-bool-query'
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
    // L15：分页契约与 400 文案统一走 @shared 桥接
    const { page: pageNum, pageSize: size } = parsePagination(page, pageSize)
    // L14：个人通知资源不套"管理员全局视图"——隐式 includeDeleted 会让管理员
    // 删除自己的通知后 refetch 仍看到该条；固定 false，无全局视图语义
    return this.notificationsService.list(
      user.sub,
      pageNum,
      size,
      parseBoolQuery(unreadOnly, false),
      false,
    )
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读通知数' })
  unreadCount(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.unreadCount(user.sub)
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @AuditAction(AUDIT_ACTIONS.MARK_READ)
  @ApiOperation({ summary: '标记单条已读' })
  @ZodSerializerDto(NotificationSchema)
  markAsRead(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.notificationsService.markAsRead(user.sub, id)
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @AuditAction(AUDIT_ACTIONS.MARK_ALL_READ)
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
