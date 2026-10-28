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
import { AuditAction } from '@/common/decorators/audit.decorator'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { consumeDailyQuota, rollbackDailyQuota } from '@/common/utils/daily-quota'
import { isAdminUser } from '@/common/utils/is-admin'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { RedisService } from '@/modules/redis/redis.service'

import { ChangePasswordDto } from './dto/change-password.dto'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UsersService } from './users.service'

// L9：建号日配额——仅 60/min 限流时持 user:create 的委托可 ~8.6 万行/日灌满 users 表
const USER_CREATE_DAILY_LIMIT = 100

@ApiTags('Users')
@Controller('users')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
  ) {}

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
    // L9：建号日配额——防持 user:create 的委托管理员受控灌满 users 表（对照 upload/backup/notify 同族日配额）
    // L2：日键随扣额返回，失败退额不会跨零点落到新日键
    const quota = await consumeDailyQuota(
      this.redisService,
      'userCreate',
      currentUser.sub,
      USER_CREATE_DAILY_LIMIT,
    )
    try {
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
      return await this.usersService.create(createUserDto, currentUser)
    } catch (err) {
      // L1：建号失败（403 越权/409 重复等）退还配额——原实现只扣不退，
      // 连续失败即静默耗干当日 100 额度且审计不可辨（对齐 upload/backup 失败即退口径）
      if (quota.consumed) {
        await rollbackDailyQuota(this.redisService, quota.key).catch(() => {})
      }
      throw err
    }
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
      if (currentUser.sub === id) {
        if (updateUserDto.roleId !== undefined) {
          throw new ForbiddenException('不能修改自己的角色')
        }
        // L12：自禁用会让当前请求方立即失去访问能力，需走其他管理员或删号流程
        if (updateUserDto.status === false) {
          throw new ForbiddenException('不能禁用当前登录账号')
        }
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
    // M1：受控解锁通道——管理员重置密码会把微信账号置 mustChangePassword=true 但占位密码不可验证，
    // 用户被锁死在强制改密环节；开放管理端显式清 flag（仅 USER_ROLE_MANAGE，防低权限篡改封锁态）
    if (updateUserDto.mustChangePassword !== undefined) {
      const canManage = await this.usersService.hasPermission(
        currentUser.sub,
        PermissionCodes.USER_ROLE_MANAGE,
      )
      if (!canManage) {
        throw new ForbiddenException('修改强制改密标记需要更高权限')
      }
    }
    return this.usersService.update(id, updateUserDto, currentUser)
  }

  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修改自己的密码（需验证旧密码）' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditAction('改密')
  async changePassword(@CurrentUser() currentUser: TokenPayload, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(currentUser.sub, dto.oldPassword, dto.newPassword)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.USER_DELETE)
  @ApiOperation({ summary: '删除用户' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    // L17①：禁止软删自己（与改密需验旧密口径一致），防持 user:delete 的操作者误锁自身账号
    // 管理员账号统一保留既有 409 契约（users.service 对全部 admin 角色用户拦截）
    if (currentUser.sub === id && !isAdminUser(currentUser)) {
      throw new ForbiddenException('不能删除当前登录账号')
    }
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
