import { SetMetadata } from '@nestjs/common'
import type { PermissionCode } from '@shared/constants/permissions'

export const PERMISSIONS_KEY = 'permissions'

export const Permissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions)
