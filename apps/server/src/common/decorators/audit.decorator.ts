import { SetMetadata } from '@nestjs/common'
import { AUDIT_ACTION_KEY, AUDIT_RESOURCE_KEY } from '@/common/interceptors/audit.interceptor'

/**
 * 显式声明审计动作/资源（拦截器默认按 HTTP 方法映射：POST=创建，
 * 登录/登出等非 CRUD 接口必须显式标注，否则审计动作全记成“创建”）。
 */
export const AuditAction = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action)
export const AuditResource = (resource: string) => SetMetadata(AUDIT_RESOURCE_KEY, resource)
