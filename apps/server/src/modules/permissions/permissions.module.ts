import { Module } from '@nestjs/common'
import { PermissionsController } from './permissions.controller'
import { PermissionsService } from './permissions.service'
import { RolePermissionsController } from './role-permissions.controller'
import { RolePermissionsService } from './role-permissions.service'

@Module({
  controllers: [PermissionsController, RolePermissionsController],
  providers: [PermissionsService, RolePermissionsService],
  exports: [PermissionsService, RolePermissionsService],
})
export class PermissionsModule {}
