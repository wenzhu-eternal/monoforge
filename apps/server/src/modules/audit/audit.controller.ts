import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { PermissionCodes } from '@shared/constants/permissions'
import { AuditLogSchema } from '@shared/schemas/audit'
import { PaginatedResponseSchema } from '@shared/schemas/pagination'
import { ZodSerializerDto } from 'nestjs-zod'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { parsePagination, parseQueryText } from '@/common/utils/pagination'
import { AuditService } from './audit.service'

@ApiTags('Audit')
@Controller('audit-logs')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Permissions(PermissionCodes.AUDIT_VIEW)
  @ApiOperation({ summary: '分页查询审计日志' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'userId', required: false, type: Number })
  @ApiQuery({ name: 'action', required: false, type: String })
  @ApiQuery({ name: 'resource', required: false, type: String })
  @ApiQuery({ name: 'keyword', required: false, type: String })
  @ZodSerializerDto(PaginatedResponseSchema(AuditLogSchema))
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('keyword') keyword?: string,
  ) {
    // L15：分页契约统一走 @shared 桥接；文本筛选加长度上限，超长直接 400
    const { page: pageNum, pageSize: size } = parsePagination(page, pageSize)
    // L15：严格数字格式——Number.parseInt('1e3')=1、'12abc'=12 会静默按错误值过滤；
    // 非法输入直接 400（与各模块 parsePagination/parseQueryText 收口口径一致）
    if (userId !== undefined && !/^\d+$/.test(userId)) {
      throw new BadRequestException('userId 必须为整数')
    }
    const parsedUserId = userId ? Number.parseInt(userId, 10) : undefined
    const filter = {
      userId: parsedUserId,
      action: parseQueryText(action, 'action'),
      resource: parseQueryText(resource, 'resource'),
      keyword: parseQueryText(keyword, 'keyword'),
    }
    return this.auditService.findAll(pageNum, size, filter)
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Permissions(PermissionCodes.AUDIT_VIEW)
  @ApiOperation({ summary: '按ID查询审计日志' })
  @ZodSerializerDto(AuditLogSchema)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.auditService.findById(id)
  }
}
