import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { PermissionCodes } from '@shared/constants/permissions'
import { DashboardStatsSchema } from '@shared/schemas/dashboard'
import { PaginatedResponseSchema } from '@shared/schemas/pagination'
import { UserListItemSchema, UserSchema } from '@shared/schemas/user'
import { ZodSerializerDto } from 'nestjs-zod'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { CacheInterceptor } from '@/modules/cache/cache.interceptor'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UsersService } from './users.service'

@ApiTags('Users')
@Controller('users')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions(PermissionCodes.USER_VIEW)
  @ApiOperation({ summary: '分页查询用户' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ZodSerializerDto(PaginatedResponseSchema(UserListItemSchema))
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() currentUser?: TokenPayload,
  ) {
    // 防御 NaN: 非数字字符串 parseInt 后为 NaN，需回落到默认值
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    const isAdmin = currentUser?.username === 'admin'
    return this.usersService.findAll(pageNum, size, isAdmin)
  }

  @Get('stats')
  @Permissions(PermissionCodes.USER_VIEW)
  @ApiOperation({ summary: '用户统计（仪表盘用）' })
  @ZodSerializerDto(DashboardStatsSchema)
  async getStats() {
    return this.usersService.getStats()
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Permissions(PermissionCodes.USER_VIEW)
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: '按ID查询用户（带缓存）' })
  @ZodSerializerDto(UserSchema)
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    const isAdmin = currentUser.username === 'admin'
    return this.usersService.findById(id, isAdmin)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions(PermissionCodes.USER_CREATE)
  @ApiOperation({ summary: '创建用户' })
  @ZodSerializerDto(UserSchema)
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto)
  }

  @Patch(':id')
  @Permissions(PermissionCodes.USER_UPDATE)
  @ApiOperation({ summary: '更新用户' })
  @ZodSerializerDto(UserSchema)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: TokenPayload,
  ) {
    // 改角色/状态需要 USER_ROLE_MANAGE 权限，防止提权
    if (updateUserDto.roleId !== undefined || updateUserDto.status !== undefined) {
      const canManage = await this.usersService.hasPermission(
        currentUser.sub,
        PermissionCodes.USER_ROLE_MANAGE,
      )
      if (!canManage) {
        throw new ForbiddenException('修改角色/状态需要更高权限')
      }
    }
    return this.usersService.update(id, updateUserDto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.USER_DELETE)
  @ApiOperation({ summary: '删除用户' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.usersService.remove(id)
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.USER_UPDATE)
  @ApiOperation({ summary: '恢复已删除用户' })
  @ZodSerializerDto(UserSchema)
  async restore(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.usersService.restore(id)
  }
}
