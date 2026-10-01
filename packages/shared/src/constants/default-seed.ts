import { PermissionCodes } from './permissions'

export interface DefaultPermission {
  code: string
  name: string
  description: string
  routes: string[]
}

/**
 * 初始化默认权限全集。
 * M11：seed 与 setup 两条初始化路径共用同一份数据——原先两处硬编码，
 * setup 路径不灌权限也不绑 admin，走 ALLOW_SETUP 初始化的部署权限功能完全空转。
 */
export const DEFAULT_PERMISSIONS: DefaultPermission[] = [
  {
    code: PermissionCodes.USER_VIEW,
    name: '查看用户',
    description: '查看用户列表和详情',
    routes: ['GET /users', 'GET /users/stats', 'GET /users/:id'],
  },
  {
    code: PermissionCodes.USER_CREATE,
    name: '创建用户',
    description: '创建新用户',
    routes: ['POST /users/'],
  },
  {
    code: PermissionCodes.USER_UPDATE,
    name: '更新用户',
    description: '编辑用户信息',
    routes: ['PATCH /users/:id'],
  },
  {
    code: PermissionCodes.USER_DELETE,
    name: '删除用户',
    description: '删除用户',
    routes: ['DELETE /users/:id', 'POST /users/:id/restore'],
  },
  {
    code: PermissionCodes.ROLE_VIEW,
    name: '查看角色',
    description: '查看角色列表和详情',
    routes: ['GET /roles', 'GET /roles/:id'],
  },
  {
    code: PermissionCodes.ROLE_CREATE,
    name: '创建角色',
    description: '创建新角色',
    routes: ['POST /roles/'],
  },
  {
    code: PermissionCodes.ROLE_UPDATE,
    name: '更新角色',
    description: '编辑角色信息',
    routes: ['PATCH /roles/:id'],
  },
  {
    code: PermissionCodes.ROLE_DELETE,
    name: '删除角色',
    description: '删除角色',
    routes: ['DELETE /roles/:id'],
  },
  {
    code: PermissionCodes.PERMISSION_VIEW,
    name: '查看权限',
    description: '查看权限列表',
    routes: ['GET /permissions', 'GET /permissions/list', 'GET /permissions/:id'],
  },
  {
    code: PermissionCodes.PERMISSION_CREATE,
    name: '创建权限',
    description: '创建新权限',
    routes: ['POST /permissions/'],
  },
  {
    code: PermissionCodes.PERMISSION_UPDATE,
    name: '更新权限',
    description: '编辑权限信息',
    routes: ['PATCH /permissions/:id'],
  },
  {
    code: PermissionCodes.PERMISSION_DELETE,
    name: '删除权限',
    description: '删除权限',
    routes: ['DELETE /permissions/:id'],
  },
  {
    code: PermissionCodes.FILE_VIEW,
    name: '查看文件',
    description: '查看文件列表与预览下载',
    routes: ['GET /files', 'GET /files/:id/preview', 'GET /files/:id/download'],
  },
  {
    code: PermissionCodes.FILE_UPLOAD,
    name: '上传文件',
    description: '上传新文件',
    routes: ['POST /files/upload'],
  },
  {
    code: PermissionCodes.FILE_DELETE,
    name: '删除文件',
    description: '删除与恢复文件',
    routes: ['DELETE /files/:id', 'POST /files/:id/restore'],
  },
  {
    code: PermissionCodes.AUDIT_VIEW,
    name: '查看审计日志',
    description: '查看审计日志',
    routes: ['GET /audit-logs', 'GET /audit-logs/:id'],
  },
  {
    code: PermissionCodes.MAIL_SEND,
    name: '发送邮件',
    description: '发送欢迎邮件和验证码',
    routes: ['POST /mail/welcome', 'POST /mail/verification-code'],
  },
  {
    code: PermissionCodes.SCHEDULE_BACKUP,
    name: '触发备份',
    description: '手动触发数据库备份',
    routes: ['POST /schedule/backup'],
  },
  {
    code: PermissionCodes.ERROR_LOG_VIEW,
    name: '查看错误日志',
    description: '查看错误日志',
    routes: [
      'GET /error-logs',
      'GET /error-logs/:id',
      'GET /error-logs/stats',
      'GET /error-logs/grouped',
      'GET /error-logs/whitelist',
    ],
  },
  {
    code: PermissionCodes.ERROR_LOG_MANAGE,
    name: '管理错误日志',
    description: '处理和管理错误日志',
    routes: [
      'GET /error-logs',
      'GET /error-logs/:id',
      'GET /error-logs/stats',
      'GET /error-logs/grouped',
      'GET /error-logs/whitelist',
      'POST /error-logs/:id/resolve',
      'POST /error-logs/batch-resolve',
      'DELETE /error-logs/:id',
      'POST /error-logs/whitelist',
      'PATCH /error-logs/whitelist/:id',
      'DELETE /error-logs/whitelist/:id',
      'POST /error-logs/whitelist/:id/restore',
    ],
  },
  {
    code: PermissionCodes.NOTIFICATION_VIEW,
    name: '查看在线状态',
    description: '查看 WebSocket 在线用户列表',
    routes: ['GET /websocket/online'],
  },
  {
    code: PermissionCodes.USER_ROLE_MANAGE,
    name: '管理用户角色',
    description: '分配/修改用户角色、状态、密码与邮箱',
    routes: ['POST /users/', 'PATCH /users/:id'],
  },
]

/**
 * 初始化默认角色（admin/user 两条，seed 与 setup 共用）。
 * editor/viewer 从 setup 路径移除：两路径统一，且原描述与"零授权"实际不符。
 * 注意：公开注册/默认建户/微信注册硬性要求 roles.name='user' 存在。
 */
export const DEFAULT_ROLES: { name: string; description: string }[] = [
  { name: 'admin', description: '系统管理员，拥有全部权限' },
  { name: 'user', description: '普通用户，通过注册进入系统' },
]

/**
 * user 角色默认权限：空集。
 * M3：原先默认授 mail:send 会构成 SMTP 开放中继——任何人公开注册后即可以系统 SMTP 身份
 * 向任意第三方持续发送钓鱼文案（多账号可放大），域名/IP 进黑名单且溯源到本系统。
 * 邮件功能保留给 admin（全量绑定），普通用户需要时由管理员显式授予。
 */
export const DEFAULT_USER_ROLE_PERMISSIONS: string[] = []
