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
import { from, tap } from 'rxjs'
import { switchMap } from 'rxjs/operators'
import { db } from '@/db'
import { errorLogs, files, notifications, roles, users } from '@/db/schema'
import { AuditService } from '@/modules/audit/audit.service'

export const AUDIT_ACTION_KEY = 'audit_action'
export const AUDIT_RESOURCE_KEY = 'audit_resource'
export const SKIP_AUDIT_KEY = 'audit_skip'

const ACTION_MAP: Record<string, string> = {
  POST: '创建',
  PATCH: '更新',
  PUT: '更新',
  DELETE: '删除',
}

// L8：非 CRUD 的 POST 一律记"创建"是错的（如恢复记成创建）。handler 名映射兜底——
// 显式 @AuditAction 优先，其次按名，最后才按方法。新增恢复类端点自动归位，无需逐个标注。
const HANDLER_ACTION_MAP: Record<string, string> = {
  restore: '恢复',
  restoreWhitelist: '恢复',
  triggerBackup: '触发备份',
}

const RESOURCE_MAP: Record<string, string> = {
  AuthController: '认证',
  UsersController: '用户',
  RolesController: '角色',
  RolePermissionsController: '角色权限',
  PermissionsController: '权限',
  FilesController: '文件',
  ErrorLogsController: '错误日志',
  error_whitelist: '白名单规则',
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
  UsersController: new Set(['password', 'email', 'phone', 'wechatOpenId']),
  // L7：角色对象无敏感列；原先掩码 id 导致"创建角色"审计无法定位被创建对象
  RolesController: new Set([]),
  FilesController: new Set([]),
  ErrorLogsController: new Set([]),
  NotificationsController: new Set([]),
}

// 响应侧敏感字段：绝不能进 audit_logs.new_value
//（H2：登录/微信登录响应曾把 accessToken 整体入库，持 audit:view 可冒充用户）
// N4：email/phone 是 PII，任何响应层级出现都掩码（登录响应的 user 嵌套对象原扁平扫描漏掩）
const SENSITIVE_RESPONSE_KEYS = new Set([
  'accessToken',
  'refreshToken',
  'password',
  'wechatOpenId',
  'verificationCode',
  'email',
  'phone',
])
const MASKED = '***MASKED***'
// 审计响应为可序列化 DTO，正常嵌套不超过 2-3 层；超限原样返回防御循环引用
const MASK_DEPTH_LIMIT = 5

// L10：审计按 int4 落库——超 int4/非数字的 :id 会让 insertLog 自身 22003 被 catch 吞掉，
// 越界写操作零留痕（可用于无痕探测）；校验后越界置 undefined，审计仍记仅缺该维度
const INT4_MIN = -2_147_483_648
const INT4_MAX = 2_147_483_647
function toSafeResourceId(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= INT4_MIN && n <= INT4_MAX ? n : undefined
}

/**
 * newValue 脱敏：复用 SENSITIVE_COLUMNS 表级规则 + 响应级 token/PII 掩码。
 * 登录审计照常记录行为（action/resource/用户/IP），仅凭据与隐私字段掩码。
 */
export function sanitizeNewValue(
  value: Record<string, unknown> | undefined,
  rawResource: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return value
  const tableSensitive = SENSITIVE_COLUMNS[rawResource]
  const scrub = (obj: Record<string, unknown>, depth: number): Record<string, unknown> => {
    if (depth > MASK_DEPTH_LIMIT) return obj
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_RESPONSE_KEYS.has(k) || tableSensitive?.has(k)) {
        out[k] = MASKED
      } else if (Array.isArray(v)) {
        out[k] = v.map((i) =>
          i && typeof i === 'object' ? scrub(i as Record<string, unknown>, depth + 1) : i,
        )
      } else if (v && typeof v === 'object') {
        out[k] = scrub(v as Record<string, unknown>, depth + 1)
      } else {
        out[k] = v
      }
    }
    return out
  }
  return Array.isArray(value)
    ? (value.map((i) =>
        typeof i === 'object' && i ? scrub(i as Record<string, unknown>, 1) : i,
      ) as unknown as Record<string, unknown>)
    : scrub(value, 1)
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

    // L12：@SkipAudit() 显式豁免——公开错误上报本身已入 error_logs（含 IP），
    // 审计再记 userId=0 的流水没有价值，只留灌水稀释审计的面
    if (this.reflector.get(SKIP_AUDIT_KEY, context.getHandler())) {
      return next.handle()
    }

    // M2：PUT 必须进审计——全仓唯一的 PUT 端点是 role-permissions 权限洗牌，属最高危变更之一
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle()
    }

    const rawAction =
      this.reflector.get<string>(AUDIT_ACTION_KEY, context.getHandler()) ??
      HANDLER_ACTION_MAP[context.getHandler().name] ??
      method
    const rawResource =
      this.reflector.get<string>(AUDIT_RESOURCE_KEY, context.getHandler()) ??
      context.getClass().name

    const action = ACTION_MAP[rawAction] ?? rawAction
    const resource = RESOURCE_MAP[rawResource] ?? rawResource

    const userId = request.user?.sub as number | undefined
    const ip = (request.ip ?? '') as string
    const userAgent = request.headers['user-agent'] as string | undefined
    const resourceId = toSafeResourceId(
      (request.params?.id ?? request.params?.roleId) as string | undefined,
    )

    // 对于更新和删除操作，先查询旧值
    const shouldFetchOldValue =
      ['PATCH', 'DELETE'].includes(method) && resourceId && TABLE_MAP[rawResource]

    // L8：旧值必须在写操作执行前读到——原先 fetch 与 handler 并发，高压下 SELECT 可能排在
    // UPDATE/DELETE 之后完成，oldValue 读到新值。改串行（多一次 SELECT 延迟，换审计准确性）。
    // 非取旧值路径（POST 创建等）同样记录，仅 oldValue 为空——绝不能直接 return 造成审计丢失。
    // 用户归因：请求已认证用 sub；账密/微信登录成功时请求尚无身份，从响应 user.id 回填
    //（L34：微信登录原先漏归因，审计记 userId=0 查不到是谁）；
    // 剩下（登录失败等匿名）记 0——user_id 列 NOT NULL，0 为匿名哨兵。
    const recordTap = (oldValue: Record<string, unknown> | undefined) => ({
      next: (data: unknown) => {
        const inner = (data as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined
        const responseUserId =
          (rawResource === 'AuthController' || rawResource === 'WechatController') &&
          typeof inner?.user === 'object' &&
          inner?.user
            ? (inner.user as { id?: unknown }).id
            : undefined
        const recordUserId = userId ?? (typeof responseUserId === 'number' ? responseUserId : 0)
        this.auditService
          .record({
            userId: recordUserId,
            action,
            resource,
            resourceId,
            oldValue,
            newValue: sanitizeNewValue(
              inner ?? (data as Record<string, unknown> | undefined),
              rawResource,
            ),
            ip,
            userAgent,
          })
          .catch((err) => this.logger.error('记录审计日志失败:', err))
      },
      error: () => {
        this.auditService
          .record({
            userId: userId ?? 0,
            action,
            resource,
            resourceId,
            oldValue,
            newValue: undefined,
            ip,
            userAgent,
          })
          .catch((err) => this.logger.error('记录审计日志(失败)失败:', err))
      },
    })

    if (!shouldFetchOldValue) {
      return next.handle().pipe(tap(recordTap(undefined)))
    }

    return from(this.fetchOldValue(rawResource, resourceId)).pipe(
      switchMap((oldValue) => next.handle().pipe(tap(recordTap(oldValue)))),
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
