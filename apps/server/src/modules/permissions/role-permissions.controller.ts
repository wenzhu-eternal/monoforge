import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PermissionCodes } from '@shared/constants/permissions'
import { RolePermissionSchema } from '@shared/schemas/permission'
import { ZodSerializerDto } from 'nestjs-zod'
import { z } from 'zod'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { isAdminUser } from '@/common/utils/is-admin'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto'
import { RolePermissionsService } from './role-permissions.service'

@ApiTags('RolePermissions')
@Controller('role-permissions')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class RolePermissionsController {
  constructor(private readonly rolePermissionsService: RolePermissionsService) {}

  @Get()
  @Permissions(PermissionCodes.PERMISSION_VIEW)
  @ApiOperation({ summary: '查询所有角色权限关联' })
  @ZodSerializerDto(z.array(RolePermissionSchema))
  async findAll() {
    return this.rolePermissionsService.findAll()
  }

  @Get('role/:roleId')
  @Permissions(PermissionCodes.PERMISSION_VIEW)
  @ApiOperation({ summary: '按角色ID查询权限码列表' })
  async findByRoleId(@Param('roleId', ParseIntPipe) roleId: number) {
    return this.rolePermissionsService.findByRoleId(roleId)
  }

  @Put('role/:roleId')
  @Permissions(PermissionCodes.PERMISSION_UPDATE)
  @ApiOperation({ summary: '更新角色权限' })
  async updateRolePermissions(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() currentUser: TokenPayload,
  ) {
    return this.rolePermissionsService.updateRolePermissions(roleId, dto.permissions, {
      userId: currentUser.sub,
      roleId: currentUser.roleId,
      isAdmin: isAdminUser(currentUser),
    })
  }
}
