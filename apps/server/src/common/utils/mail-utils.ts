/**
 * 邮箱脱敏：保留首字符与域名，隐藏本地部分
 * 用于日志输出和审计新值，防止邮箱明文落入日志/audit_logs
 */
export const maskEmail = (email: string): string => {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***${email.slice(at)}`
}
