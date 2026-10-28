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
import { Throttle } from '@nestjs/throttler'
import { PermissionCodes } from '@shared/constants/permissions'
import { PaginatedResponseSchema } from '@shared/schemas/pagination'
import { RoleSchema } from '@shared/schemas/role'
import { ZodSerializerDto } from 'nestjs-zod'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { isAdminUser } from '@/common/utils/is-admin'
import { parsePagination } from '@/common/utils/pagination'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { RolesService } from './roles.service'

@ApiTags('Roles')
@Controller('roles')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Permissions(PermissionCodes.ROLE_VIEW)
  @ApiOperation({ summary: '分页查询角色' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ZodSerializerDto(PaginatedResponseSchema(RoleSchema))
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() currentUser?: TokenPayload,
  ) {
    // L15：分页契约与 400 文案统一走 @shared 桥接
    const { page: pageNum, pageSize: size } = parsePagination(page, pageSize)
    const isAdmin = isAdminUser(currentUser)
    return this.rolesService.findAll(pageNum, size, isAdmin)
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Permissions(PermissionCodes.ROLE_VIEW)
  @ApiOperation({ summary: '按ID查询角色' })
  @ZodSerializerDto(RoleSchema)
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    const isAdmin = isAdminUser(currentUser)
    return this.rolesService.findById(id, isAdmin)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions(PermissionCodes.ROLE_CREATE)
  @ApiOperation({ summary: '创建角色' })
  @ZodSerializerDto(RoleSchema)
  async create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.create(createRoleDto)
  }

  @Patch(':id')
  @Permissions(PermissionCodes.ROLE_UPDATE)
  @ApiOperation({ summary: '更新角色' })
  @ZodSerializerDto(RoleSchema)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentUser() currentUser: TokenPayload,
  ) {
    const isAdmin = isAdminUser(currentUser)
    return this.rolesService.update(id, updateRoleDto, isAdmin)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.ROLE_DELETE)
  @ApiOperation({ summary: '删除角色' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.rolesService.remove(id)
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.ROLE_DELETE)
  @ApiOperation({ summary: '恢复已删除角色' })
  @ZodSerializerDto(RoleSchema)
  async restore(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: TokenPayload) {
    return this.rolesService.restore(id)
  }
}
