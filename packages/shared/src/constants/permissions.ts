export const PermissionCodes = {
  USER_VIEW: 'user:view',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  ROLE_VIEW: 'role:view',
  ROLE_CREATE: 'role:create',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  PERMISSION_VIEW: 'permission:view',
  PERMISSION_CREATE: 'permission:create',
  PERMISSION_UPDATE: 'permission:update',
  PERMISSION_DELETE: 'permission:delete',
  FILE_VIEW: 'file:view',
  FILE_UPLOAD: 'file:upload',
  FILE_DELETE: 'file:delete',
  AUDIT_VIEW: 'audit:view',
  MAIL_SEND: 'mail:send',
  SCHEDULE_BACKUP: 'schedule:backup',
  ERROR_LOG_VIEW: 'error_log:view',
  ERROR_LOG_MANAGE: 'error_log:manage',
} as const

export type PermissionCode = (typeof PermissionCodes)[keyof typeof PermissionCodes]
