import { Injectable, NestMiddleware } from '@nestjs/common'
import type { Request, Response } from 'express'

// 需要脱敏的字段名（小写子串匹配）
// M7：原表用完整词 'phonenumber'——真实键常是 'phone'，'phone'.includes('phonenumber')
// 为 false 恒不命中；email/code 完全缺席。任何过滤镜入库的请求体（401/403/429/5xx 的
// error_logs.context）中 email/phone/验证码明文落库，与 L2 掩码口径相悖
const SENSITIVE_FIELDS = [
  'password',
  'passwd',
  'token',
  'secret',
  'authorization',
  'creditcard',
  'idcard',
  'phone',
  'email',
]
// L8：'to'/'code' 改精确匹配——子串匹配会把 total/topic/inviteCode/postalCode 误打码，
// 5xx 排障丢失关键上下文；验证码键用白名单枚举保精确覆盖
const SENSITIVE_EXACT_FIELDS = new Set(['to', 'code', 'verificationcode', 'smscode', 'captchacode'])

const MASK = '***REDACTED***'

/** 数据脱敏中间件：将脱敏后的 body 存到 req.sanitizedBody，用于日志记录场景 */
@Injectable()
export class SanitizeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: () => void) {
    if (req.body && typeof req.body === 'object') {
      req.sanitizedBody = this.sanitize(req.body)
    }
    next()
  }

  /**
   * 递归脱敏对象中的敏感字段
   */
  private sanitize(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitize(item))
    }

    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase()
        if (
          SENSITIVE_EXACT_FIELDS.has(lowerKey) ||
          SENSITIVE_FIELDS.some((field) => lowerKey.includes(field))
        ) {
          result[key] = MASK
        } else if (value && typeof value === 'object') {
          result[key] = this.sanitize(value)
        } else {
          result[key] = value
        }
      }
      return result
    }

    return obj
  }
}

declare module 'express' {
  interface Request {
    sanitizedBody?: unknown
  }
}
