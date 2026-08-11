import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { Request } from 'express'

/**
 * 自定义限流守卫：
 * 1. 已认证用户按 userId 维度限流（注：因 APP_GUARD 顺序 AuthGuard 在后，当前 request.user 未设置，实际走 IP 维度，待修复守卫顺序）
 * 2. 未认证用户按 IP 维度限流
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request & { user?: { sub?: number } }
    // 已认证用户按 userId 维度，避免 NAT 共享 IP 误伤
    if (request.user?.sub) {
      return `user:${request.user.sub}`
    }
    // 未认证用户回退到 IP
    return request.ip || 'unknown'
  }
}
