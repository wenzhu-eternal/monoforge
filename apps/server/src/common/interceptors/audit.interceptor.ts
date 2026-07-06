import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { eq, type Table } from 'drizzle-orm'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs'
import { db } from '@/db'
import { errorLogs, files, notifications, roles, users } from '@/db/schema'
import { AuditService } from '@/modules/audit/audit.service'

export const AUDIT_ACTION_KEY = 'audit_action'
export const AUDIT_RESOURCE_KEY = 'audit_resource'

// HTTP 方法到中文动作的映射
const ACTION_MAP: Record<string, string> = {
  POST: '创建',
  PATCH: '更新',
  DELETE: '删除',
}

// Controller 类名到中文资源的映射
const RESOURCE_MAP: Record<string, string> = {
  AuthController: '认证',
  UsersController: '用户',
  RolesController: '角色',
  PermissionsController: '权限',
  FilesController: '文件',
  ErrorLogsController: '错误日志',
  AuditController: '审计日志',
  NotificationsController: '通知',
  WechatController: '微信',
  SetupController: '系统设置',
  WebSocketController: 'WebSocket',
  RoutesController: '路由',
}

// Controller 类名到数据库表和ID字段的映射（用于查询旧值）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLE_MAP: Record<string, { table: Table; idField: any }> = {
  UsersController: { table: users, idField: users.id },
  RolesController: { table: roles, idField: roles.id },
  FilesController: { table: files, idField: files.id },
  ErrorLogsController: { table: errorLogs, idField: errorLogs.id },
  NotificationsController: { table: notifications, idField: notifications.id },
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest()
    const method = request.method

    if (!['POST', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle()
    }

    // 获取中文动作和资源
    const rawAction = this.reflector.get<string>(AUDIT_ACTION_KEY, context.getHandler()) ?? method
    const rawResource =
      this.reflector.get<string>(AUDIT_RESOURCE_KEY, context.getHandler()) ??
      context.getClass().name

    // 转换为中文
    const action = ACTION_MAP[rawAction] ?? rawAction
    const resource = RESOURCE_MAP[rawResource] ?? rawResource

    // 修复: AuthGuard 设置的 payload 字段为 sub（非 id）
    const userId = request.user?.sub as number | undefined
    // 反向代理下 request.ip 是代理 IP，取 x-forwarded-for 第一段作为真实客户端 IP
    const forwardedFor = request.headers['x-forwarded-for'] as string | undefined
    const ip = forwardedFor?.split(',')[0]?.trim() ?? request.ip
    const userAgent = request.headers['user-agent'] as string | undefined
    const resourceId = request.params?.id as string | undefined

    // 对于更新和删除操作，先查询旧值
    const shouldFetchOldValue =
      ['PATCH', 'DELETE'].includes(method) && resourceId && TABLE_MAP[rawResource]

    const oldValuePromise = shouldFetchOldValue
      ? this.fetchOldValue(rawResource, Number(resourceId))
      : Promise.resolve(undefined)

    return next.handle().pipe(
      tap((data) => {
        // 审计失败不应阻断主业务，仅记录错误日志
        if (userId) {
          oldValuePromise
            .then((oldValue) => {
              return this.auditService.record({
                userId,
                action,
                resource,
                resourceId: resourceId ? Number(resourceId) : undefined,
                oldValue,
                newValue: data as Record<string, unknown> | undefined,
                ip,
                userAgent,
              })
            })
            .catch((err) => console.error('[Audit] 记录审计日志失败:', err))
        }
      }),
    )
  }

  private async fetchOldValue(
    resource: string,
    id: number,
  ): Promise<Record<string, unknown> | undefined> {
    const config = TABLE_MAP[resource]
    if (!config) return undefined

    try {
      const result = await db.select().from(config.table).where(eq(config.idField, id)).limit(1)

      if (result.length === 0) return undefined

      // 转换为普通对象，移除敏感字段
      const oldData = { ...result[0] }
      if ('password' in oldData) {
        delete (oldData as Record<string, unknown>).password
      }
      return oldData as Record<string, unknown>
    } catch {
      return undefined
    }
  }
}
