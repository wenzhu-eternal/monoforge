/**
 * Q7：审计动作词表唯一来源——后端 audit.interceptor 的 ACTION_MAP / HANDLER_ACTION_MAP /
 * @AuditAction 标注，与前端审计页的筛选下拉、动作色卡共用本表，避免两侧手抄副本漂移。
 */
export const AUDIT_ACTIONS = {
  CREATE: '创建',
  UPDATE: '更新',
  DELETE: '删除',
  RESTORE: '恢复',
  TRIGGER_BACKUP: '触发备份',
  LOGIN: '登录',
  REGISTER: '注册',
  LOGOUT: '登出',
  REFRESH_TOKEN: '刷新令牌',
  SEND_CODE: '发送验证码',
  CHANGE_PASSWORD: '改密',
  PROCESS: '处理',
  BATCH_PROCESS: '批量处理',
  MARK_READ: '标记已读',
  MARK_ALL_READ: '全部标记已读',
  SEND_NOTIFICATION: '发送通知',
  SEND_WELCOME_MAIL: '发送欢迎邮件',
  SEND_TEST_MAIL: '发送测试邮件',
} as const

export type AuditActionName = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

/** 全量动作名（前端筛选下拉按此渲染） */
export const AUDIT_ACTION_NAMES: AuditActionName[] = Object.values(AUDIT_ACTIONS)
