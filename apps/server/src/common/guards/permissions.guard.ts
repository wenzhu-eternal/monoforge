import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import { and, eq, inArray } from 'drizzle-orm'
import type { Request } from 'express'
import { PERMISSIONS_KEY } from '@/common/decorators/permissions.decorator'
import { isAdminUser } from '@/common/utils/is-admin'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { permissions, rolePermissions, roles, users } from '@/db/schema'
import { RedisService } from '@/modules/redis/redis.service'

interface AuthenticatedRequest extends Request {
  user?: {
    sub: number
    username: string
    email: string
    roleId: number | null
  }
}

/**
 * 权限守卫: 根据 @Permissions(...) 元数据校验当前用户是否拥有指定权限
 * 通过 users.roleId → role_permissions.permission 获取用户权限码列表
 * ADMIN_ROLE_ID 匹配时视为拥有所有权限（可配置，默认 1）
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  private getPermissionCacheKey(roleId: number): string {
    return `perm:role:${roleId}`
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    )

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const userPayload = request.user
    if (!userPayload) {
      throw new ForbiddenException('未认证用户')
    }

    // 基于角色 ID 判断 admin（可配置 ADMIN_ROLE_ID，默认 1）
    if (isAdminUser(userPayload)) {
      return true
    }

    const userRecord = await db.query.users.findFirst({
      where: and(eq(users.id, userPayload.sub), notDeleted(users.deletedAt)),
    })
    if (!userRecord?.roleId) {
      throw new ForbiddenException(ErrorMessages[ErrorCodes.PERMISSION_DENIED])
    }

    const roleRecord = await db.query.roles.findFirst({
      where: eq(roles.id, userRecord.roleId),
    })
    if (!roleRecord || roleRecord.deletedAt) {
      throw new ForbiddenException(ErrorMessages[ErrorCodes.PERMISSION_DENIED])
    }

    // 查询用户权限码，优先走 Redis 缓存
    const cacheKey = this.getPermissionCacheKey(userRecord.roleId)
    let permissionCodes: string[] | null = null
    const cached = await this.redisService.get(cacheKey)
    if (cached) {
      try {
        permissionCodes = JSON.parse(cached) as string[]
      } catch {
        /* ignore */
      }
    }
    if (!permissionCodes) {
      const userPermissions = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .innerJoin(
          permissions,
          and(eq(rolePermissions.permission, permissions.code), notDeleted(permissions.deletedAt)),
        )
        .where(eq(rolePermissions.roleId, userRecord.roleId))
      permissionCodes = userPermissions.map((p) => p.permission)
      void this.redisService.set(cacheKey, JSON.stringify(permissionCodes), 300)
    }

    const hasAll = requiredPermissions.every((p) => permissionCodes.includes(p))
    if (hasAll) {
      return true
    }

    // 权限码不足时，检查路由权限白名单（取并集，非仅第一个）
    const permissionRecords =
      permissionCodes.length > 0
        ? await db.query.permissions.findMany({
            where: and(
              inArray(permissions.code, permissionCodes),
              notDeleted(permissions.deletedAt),
            ),
          })
        : []

    const allowedRoutes = permissionRecords.flatMap((p) => p.routes ?? [])

    const currentMethod = request.method
    // 剥离全局前缀（/api/v1），与 seed/permissions 表中 routes 字段保持一致
    const currentPath = request.path.replace(/^\/api\/v1/, '')
    const currentRoute = `${currentMethod} ${currentPath}`

    const isAllowed = allowedRoutes.some((route) => {
      if (route === currentRoute) return true
      // 通配符匹配 (如 GET /users/*，seed 中 routes 用 :id 参数格式)
      if (route.endsWith('*')) {
        const prefix = route.slice(0, -1)
        return currentRoute.startsWith(prefix)
      }
      return false
    })

    if (!isAllowed) {
      throw new ForbiddenException(
        `${ErrorMessages[ErrorCodes.PERMISSION_DENIED]}: ${requiredPermissions.join(', ')}`,
      )
    }

    return true
  }
}
