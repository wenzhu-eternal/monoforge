import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS_KEY = 'permissions'

/**
 * 权限装饰器: 根据权限码校验当前用户是否拥有指定权限
 * @Permissions('audit:view')
 * @Permissions('user:create', 'user:update')
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions)
