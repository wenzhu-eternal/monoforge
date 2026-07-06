import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { AuthGuard } from '@/modules/auth/auth.guard'
import { RolePermissionsService } from './role-permissions.service'

@ApiTags('RolePermissions')
@Controller('role-permissions')
@UseGuards(AuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RolePermissionsController {
  constructor(private readonly rolePermissionsService: RolePermissionsService) {}

  @Get()
  @Permissions('permission:view')
  @ApiOperation({ summary: '查询所有角色权限关联' })
  async findAll() {
    return this.rolePermissionsService.findAll()
  }

  @Get('role/:roleId')
  @Permissions('permission:view')
  @ApiOperation({ summary: '按角色ID查询权限码列表' })
  async findByRoleId(@Param('roleId', ParseIntPipe) roleId: number) {
    return this.rolePermissionsService.findByRoleId(roleId)
  }

  @Put('role/:roleId')
  @Permissions('permission:update')
  @ApiOperation({ summary: '更新角色权限' })
  async updateRolePermissions(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Body() data: { permissions: string[] },
  ) {
    return this.rolePermissionsService.updateRolePermissions(roleId, data.permissions)
  }
}
