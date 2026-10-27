import { BadRequestException } from '@nestjs/common'

/**
 * L8：布尔 query 参数严格解析——仅接受 true/false，其余（1/True/yes 等）返回 400 指路，
 * 不把非 'true' 值静默折叠成 false（否则真值语义相反且无提示）。
 */
export function parseBoolQuery(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new BadRequestException('布尔参数仅支持 true 或 false')
}
