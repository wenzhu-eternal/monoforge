import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { and, eq, isNull, type Table } from 'drizzle-orm'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs'
import { db } from '@/db'
import { errorLogs, files, notifications, roles, users } from '@/db/schema'
import { AuditService } from '@/modules/audit/audit.service'

export const AUDIT_ACTION_KEY = 'audit_action'
export const AUDIT_RESOURCE_KEY = 'audit_resource'

const ACTION_MAP: Record<string, string> = {
  POST: '创建',
  PATCH: '更新',
  DELETE: '删除',
}

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
// biome-ignore lint/suspicious/noExplicitAny: Drizzle Column 泛型推导过于复杂
const TABLE_MAP: Record<string, { table: Table; idField: any; deletedAtField?: any }> = {
  UsersController: { table: users, idField: users.id, deletedAtField: users.deletedAt },
  RolesController: { table: roles, idField: roles.id, deletedAtField: roles.deletedAt },
  FilesController: { table: files, idField: files.id, deletedAtField: files.deletedAt },
  ErrorLogsController: {
    table: errorLogs,
    idField: errorLogs.id,
    deletedAtField: errorLogs.deletedAt,
  },
  NotificationsController: {
    table: notifications,
    idField: notifications.id,
    deletedAtField: notifications.deletedAt,
  },
}

const SENSITIVE_COLUMNS: Record<string, Set<string>> = {
  UsersController: new Set(['password', 'email', 'phone', 'wechatOpenId', 'wechatUnionId']),
  RolesController: new Set(['id']),
  FilesController: new Set([]),
  ErrorLogsController: new Set([]),
  NotificationsController: new Set([]),
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name)

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

    const rawAction = this.reflector.get<string>(AUDIT_ACTION_KEY, context.getHandler()) ?? method
    const rawResource =
      this.reflector.get<string>(AUDIT_RESOURCE_KEY, context.getHandler()) ??
      context.getClass().name

    const action = ACTION_MAP[rawAction] ?? rawAction
    const resource = RESOURCE_MAP[rawResource] ?? rawResource

    const userId = request.user?.sub as number | undefined
    const ip = (request.ip ?? '') as string
    const userAgent = request.headers['user-agent'] as string | undefined
    const resourceId = request.params?.id as string | undefined

    // 对于更新和删除操作，先查询旧值
    const shouldFetchOldValue =
      ['PATCH', 'DELETE'].includes(method) && resourceId && TABLE_MAP[rawResource]

    const oldValuePromise = shouldFetchOldValue
      ? this.fetchOldValue(rawResource, Number(resourceId))
      : Promise.resolve(undefined)

    return next.handle().pipe(
      tap({
        next: (data) => {
          oldValuePromise
            .then((oldValue) => {
              return this.auditService.record({
                userId: userId ?? 0,
                action,
                resource,
                resourceId: resourceId ? Number(resourceId) : undefined,
                oldValue,
                newValue:
                  ((data as Record<string, unknown>)?.data as
                    | Record<string, unknown>
                    | undefined) ?? (data as Record<string, unknown> | undefined),
                ip,
                userAgent,
              })
            })
            .catch((err) => this.logger.error('记录审计日志失败:', err))
        },
        error: () => {
          oldValuePromise
            .then((oldValue) => {
              return this.auditService.record({
                userId: userId ?? 0,
                action,
                resource,
                resourceId: resourceId ? Number(resourceId) : undefined,
                oldValue,
                newValue: undefined,
                ip,
                userAgent,
              })
            })
            .catch((err) => this.logger.error('记录审计日志(失败)失败:', err))
        },
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
      const whereClause = config.deletedAtField
        ? and(eq(config.idField, id), isNull(config.deletedAtField))
        : eq(config.idField, id)
      const result = await db.select().from(config.table).where(whereClause).limit(1)

      if (result.length === 0) return undefined

      const sensitiveFields = SENSITIVE_COLUMNS[resource]
      const oldData: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(result[0] as Record<string, unknown>)) {
        if (!sensitiveFields?.has(key)) {
          oldData[key] = val
        }
      }
      return oldData
    } catch {
      return undefined
    }
  }
}
