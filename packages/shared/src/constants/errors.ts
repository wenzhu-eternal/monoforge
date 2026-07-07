export const ErrorCodes = {
  // 通用错误
  SUCCESS: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,

  // 用户相关
  USER_NOT_FOUND: 1001,
  USER_ALREADY_EXISTS: 1002,
  USER_DISABLED: 1003,
  INVALID_PASSWORD: 1004,
  INVALID_TOKEN: 1005,
  TOKEN_EXPIRED: 1006,
  REFRESH_TOKEN_INVALID: 1007,
  INITIAL_ADMIN_CANNOT_DELETE: 1008,

  // 角色相关
  ROLE_NOT_FOUND: 2001,
  ROLE_ALREADY_EXISTS: 2002,

  // 文件相关
  FILE_NOT_FOUND: 3001,
  FILE_TOO_LARGE: 3002,
  INVALID_FILE_TYPE: 3003,

  // 业务相关
  OPERATION_FAILED: 4001,
  VALIDATION_FAILED: 4002,
  RATE_LIMIT_EXCEEDED: 4003,
} as const

export const ErrorMessages = {
  [ErrorCodes.SUCCESS]: '成功',
  [ErrorCodes.BAD_REQUEST]: '请求参数错误',
  [ErrorCodes.UNAUTHORIZED]: '未授权，请先登录',
  [ErrorCodes.FORBIDDEN]: '禁止访问，权限不足',
  [ErrorCodes.NOT_FOUND]: '资源不存在',
  [ErrorCodes.INTERNAL_SERVER_ERROR]: '服务器内部错误',
  [ErrorCodes.USER_NOT_FOUND]: '用户不存在',
  [ErrorCodes.USER_ALREADY_EXISTS]: '用户已存在',
  [ErrorCodes.USER_DISABLED]: '账号已被禁用',
  [ErrorCodes.INVALID_PASSWORD]: '密码错误',
  [ErrorCodes.INVALID_TOKEN]: '令牌无效',
  [ErrorCodes.TOKEN_EXPIRED]: '令牌已过期',
  [ErrorCodes.REFRESH_TOKEN_INVALID]: '刷新令牌无效',
  [ErrorCodes.INITIAL_ADMIN_CANNOT_DELETE]: '初始管理员账号不可删除',
  [ErrorCodes.ROLE_NOT_FOUND]: '角色不存在',
  [ErrorCodes.ROLE_ALREADY_EXISTS]: '角色已存在',
  [ErrorCodes.FILE_NOT_FOUND]: '文件不存在',
  [ErrorCodes.FILE_TOO_LARGE]: '文件过大',
  [ErrorCodes.INVALID_FILE_TYPE]: '文件类型无效',
  [ErrorCodes.OPERATION_FAILED]: '操作失败',
  [ErrorCodes.VALIDATION_FAILED]: '数据校验失败',
  [ErrorCodes.RATE_LIMIT_EXCEEDED]: '请求过于频繁，请稍后再试',
} as const
