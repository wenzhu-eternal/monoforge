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
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    const filter = {
      userId: userId ? Number.parseInt(userId, 10) : undefined,
      action,
      resource,
      keyword,
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
