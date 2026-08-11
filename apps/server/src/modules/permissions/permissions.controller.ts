import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { PermissionCodes } from '@shared/constants/permissions'
import { PaginatedResponseSchema } from '@shared/schemas/pagination'
import { PermissionSchema } from '@shared/schemas/permission'
import { ZodSerializerDto } from 'nestjs-zod'
import { z } from 'zod'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { isAdminUser } from '@/common/utils/is-admin'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { CreatePermissionDto, UpdatePermissionDto } from './dto/permission.dto'
import { PermissionsService } from './permissions.service'

@ApiTags('Permissions')
@Controller('permissions')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @Permissions(PermissionCodes.PERMISSION_VIEW)
  @ApiOperation({ summary: '分页查询权限' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ZodSerializerDto(PaginatedResponseSchema(PermissionSchema))
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() currentUser?: TokenPayload,
  ) {
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    // 防御 NaN: 非数字字符串 parseInt 后为 NaN，直接抛 400 错误
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    const isAdmin = isAdminUser(currentUser)
    return this.permissionsService.findAll(pageNum, size, isAdmin)
  }

  @Get('list')
  @Permissions(PermissionCodes.PERMISSION_VIEW)
  @ApiOperation({ summary: '查询所有权限（不分页）' })
  @ZodSerializerDto(z.array(PermissionSchema))
  async findAllList() {
    return this.permissionsService.findAllList()
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Permissions(PermissionCodes.PERMISSION_VIEW)
  @ApiOperation({ summary: '按ID查询权限' })
  @ZodSerializerDto(PermissionSchema)
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    const isAdmin = isAdminUser(currentUser)
    return this.permissionsService.findById(id, isAdmin)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions(PermissionCodes.PERMISSION_CREATE)
  @ApiOperation({ summary: '创建权限' })
  @ZodSerializerDto(PermissionSchema)
  async create(@Body() dto: CreatePermissionDto) {
    return this.permissionsService.create(dto)
  }

  @Patch(':id')
  @Permissions(PermissionCodes.PERMISSION_UPDATE)
  @ApiOperation({ summary: '更新权限' })
  @ZodSerializerDto(PermissionSchema)
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePermissionDto) {
    return this.permissionsService.update(id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.PERMISSION_DELETE)
  @ApiOperation({ summary: '删除权限' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.permissionsService.remove(id)
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.PERMISSION_UPDATE)
  @ApiOperation({ summary: '恢复已删除权限' })
  @ZodSerializerDto(PermissionSchema)
  async restore(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.permissionsService.restore(id)
  }
}
