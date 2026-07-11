import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { and, eq } from 'drizzle-orm'
import type { Request } from 'express'
import { ROLES_KEY } from '@/common/decorators/roles.decorator'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { roles, users } from '@/db/schema'

interface AuthenticatedRequest extends Request {
  user?: {
    sub: number
    username: string
    email: string
  }
}

/**
 * 角色守卫: 根据 @Roles(...) 元数据校验当前用户的角色名是否匹配
 * 通过 users.roleId 关联 roles.name 获取角色名
 * 兼容兜底: username === 'admin' 视为管理员（无角色关联时）
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // 未标记 @Roles 则放行（任意登录用户可访问）
    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const userPayload = request.user
    if (!userPayload) {
      throw new ForbiddenException('未认证用户')
    }

    // 兜底: admin 用户名直接视为管理员（兼容未关联角色的旧数据）
    if (userPayload.username === 'admin' && requiredRoles.includes('admin')) {
      return true
    }

    // 查询用户角色（过滤软删除）
    const userRecord = await db.query.users.findFirst({
      where: and(eq(users.id, userPayload.sub), notDeleted(users.deletedAt)),
    })
    if (!userRecord?.roleId) {
      throw new ForbiddenException('权限不足，未分配角色')
    }

    const roleRecord = await db.query.roles.findFirst({
      where: and(eq(roles.id, userRecord.roleId), notDeleted(roles.deletedAt)),
    })
    if (!roleRecord) {
      throw new ForbiddenException('权限不足，角色不存在')
    }

    if (!requiredRoles.includes(roleRecord.name)) {
      throw new ForbiddenException(`权限不足，需要角色: ${requiredRoles.join(', ')}`)
    }

    return true
  }
}
