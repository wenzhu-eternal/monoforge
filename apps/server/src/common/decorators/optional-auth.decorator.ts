import { SetMetadata } from '@nestjs/common'

export const IS_OPTIONAL_AUTH_KEY = 'optionalAuth'

/**
 * L11：公开路由上的"有 token 则解析、无/无效 token 一律放行"——
 * 用于 health 这类匿名可访问、但需按身份裁剪响应详情的端点。
 * 必须与 @Public() 同时使用（缺少 @Public 时按普通鉴权处理）
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true)
