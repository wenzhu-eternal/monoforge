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
import { isAdminUser } from '@/common/utils/is-admin'
import { type TokenPayload } from '@/modules/auth/auth.service'

import { ChangePasswordDto } from './dto/change-password.dto'
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
    // 防御 NaN: 非数字字符串 parseInt 后为 NaN，直接抛 400 错误
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    const isAdmin = isAdminUser(currentUser)
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
  @ApiOperation({ summary: '按ID查询用户' })
  @ZodSerializerDto(UserSchema)
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    const isAdmin = isAdminUser(currentUser)
    return this.usersService.findById(id, isAdmin)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions(PermissionCodes.USER_CREATE)
  @ApiOperation({ summary: '创建用户' })
  @ZodSerializerDto(UserSchema)
  async create(@Body() createUserDto: CreateUserDto, @CurrentUser() currentUser: TokenPayload) {
    // 指定角色属于敏感操作（防提权）: 仅 USER_ROLE_MANAGE 权限可指定 roleId，
    // 未指定时由 service 默认分配普通角色
    if (createUserDto.roleId !== undefined) {
      const canManage = await this.usersService.hasPermission(
        currentUser.sub,
        PermissionCodes.USER_ROLE_MANAGE,
      )
      if (!canManage) {
        throw new ForbiddenException('指定角色需要更高权限')
      }
    }
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
      // 自改角色一律禁止（含 admin）：持 USER_ROLE_MANAGE 的普通用户可把自己改成 admin 角色完成提权，
      // role-permissions 已有同款"禁改自身角色"防线，此处补齐 users.update 路径
      if (currentUser.sub === id && updateUserDto.roleId !== undefined) {
        throw new ForbiddenException('不能修改自己的角色')
      }
      const canManage = await this.usersService.hasPermission(
        currentUser.sub,
        PermissionCodes.USER_ROLE_MANAGE,
      )
      if (!canManage) {
        throw new ForbiddenException('修改角色/状态需要更高权限')
      }
    }
    // 邮箱换绑是账号接管链路的一环: 无论改自己还是他人，一律要求 USER_ROLE_MANAGE（自改无门槛会被泄露 token 利用）
    if (updateUserDto.email !== undefined) {
      const canManage = await this.usersService.hasPermission(
        currentUser.sub,
        PermissionCodes.USER_ROLE_MANAGE,
      )
      if (!canManage) {
        throw new ForbiddenException('修改邮箱需要更高权限')
      }
    }
    // 改他人密码需要 USER_ROLE_MANAGE 权限，防止账号接管
    if (updateUserDto.password !== undefined) {
      if (currentUser.sub !== id) {
        const canManage = await this.usersService.hasPermission(
          currentUser.sub,
          PermissionCodes.USER_ROLE_MANAGE,
        )
        if (!canManage) {
          throw new ForbiddenException('修改他人密码需要更高权限')
        }
      } else {
        // 改自己密码必须走 /me/password 接口验证旧密码
        throw new ForbiddenException('请使用修改密码接口更改自己的密码')
      }
    }
    return this.usersService.update(id, updateUserDto)
  }

  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修改自己的密码（需验证旧密码）' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(@CurrentUser() currentUser: TokenPayload, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(currentUser.sub, dto.oldPassword, dto.newPassword)
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
  @Permissions(PermissionCodes.USER_DELETE)
  @ApiOperation({ summary: '恢复已删除用户' })
  @ZodSerializerDto(UserSchema)
  async restore(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.usersService.restore(id)
  }
}
