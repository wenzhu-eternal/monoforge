import {
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
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { AuthGuard } from '@/modules/auth/auth.guard'
import { CreatePermissionDto, UpdatePermissionDto } from './dto/permission.dto'
import { PermissionsService } from './permissions.service'

@ApiTags('Permissions')
@Controller('permissions')
@UseGuards(AuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @Permissions('permission:view')
  @ApiOperation({ summary: '分页查询权限' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async findAll(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    return this.permissionsService.findAll(pageNum, size)
  }

  @Get('list')
  @Permissions('permission:view')
  @ApiOperation({ summary: '查询所有权限（不分页）' })
  async findAllList() {
    return this.permissionsService.findAllList()
  }

  @Get(':id')
  @Permissions('permission:view')
  @ApiOperation({ summary: '按ID查询权限' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.permissionsService.findById(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('permission:create')
  @ApiOperation({ summary: '创建权限' })
  async create(@Body() dto: CreatePermissionDto) {
    return this.permissionsService.create(dto)
  }

  @Patch(':id')
  @Permissions('permission:update')
  @ApiOperation({ summary: '更新权限' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePermissionDto) {
    return this.permissionsService.update(id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('permission:delete')
  @ApiOperation({ summary: '删除权限' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.permissionsService.remove(id)
  }
}
