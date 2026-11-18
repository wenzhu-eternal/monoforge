import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import multer from 'multer'
import { appendErrorLog } from '@/common/logger'
import { ErrorLogsService } from '@/modules/error-logs/error-logs.service'

/**
 * H01：日志字符串限长 + 凭证模式脱敏——异常 message／string cause 可能含凭证或超长文本，
 * 进入文件与 DB 日志前统一脱敏/截断；仅匹配显式凭证键，保留 ENOENT/EACCES 等故障码。
 */
const MAX_LOG_FIELD_LENGTH = 2000

function sanitizeLogText(text: string): string {
  const redacted = text.replace(
    /(password|passwd|pwd|token|secret|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S+/gi,
    '$1=***REDACTED***',
  )
  return redacted.length > MAX_LOG_FIELD_LENGTH
    ? `${redacted.slice(0, MAX_LOG_FIELD_LENGTH)}…(truncated)`
    : redacted
}

/**
 * R10：有界、防循环地抽取异常 cause 链的关键信息（故障码 + 消息），供错误日志排障。
 * 只取 string/number 型 code 与 Error.message，不内联对象/凭证，避免磁盘细节外泄。
 */
function describeCauseChain(exception: unknown, maxDepth = 3): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current = exception
  for (let depth = 0; depth < maxDepth && current != null; depth++) {
    if (typeof current === 'object') {
      if (seen.has(current)) break
      seen.add(current)
    }
    const cause = (current as { cause?: unknown })?.cause
    if (cause == null) break

    if (typeof cause === 'string' || typeof cause === 'number' || typeof cause === 'boolean') {
      parts.push(String(cause))
    } else {
      const code = (cause as { code?: unknown })?.code
      const message = cause instanceof Error ? cause.message : undefined
      const codeStr =
        typeof code === 'string' ? code : typeof code === 'number' ? String(code) : undefined
      const pieces = [codeStr, message].filter((p): p is string => typeof p === 'string')
      if (pieces.length > 0) parts.push(pieces.join(': '))
    }
    current = cause
  }
  return parts.length > 0 ? sanitizeLogText(parts.join(' <- ')) : ''
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  constructor(private readonly errorLogsService: ErrorLogsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = '服务器内部错误'
    let shouldRecordToDb = false

    // L11/M3：Multer 超限（如文件过大）返回 413，避免以 500 入库污染错误日志。
    // M3：MulterError extends Error 而非 HttpException（实读 multer 源码），判定必须在
    // HttpException 分支之外——原嵌套在其内为永不可达死代码，超限上传仍 500 入库
    if (exception instanceof multer.MulterError) {
      if (exception.code === 'LIMIT_FILE_SIZE') {
        status = HttpStatus.PAYLOAD_TOO_LARGE // 413
        message = '文件过大，请上传 10MB 以内的文件'
      } else {
        // L14：字段名错（LIMIT_UNEXPECTED_FILE）/文件数超限等与真超限同文案同码 413 会误导；
        // 其余 Multer 错误回 400 + 原始 code，不复用"文件过大"语义
        status = HttpStatus.BAD_REQUEST
        message = `文件上传参数错误: ${exception.code}`
      }
      shouldRecordToDb = false
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      const exceptionResponse = exception.getResponse()

      // nestjs-zod 的 ZodSerializationException/ZodValidationException 会把 ZodError 挂在 error 上
      // 完整 issues 仅写入日志便于排障，不回传客户端以避免暴露字段约束
      const zodError = (exception as { getZodError?: () => unknown }).getZodError?.()
      let zodIssuesLogged = false
      if (zodError && typeof zodError === 'object' && 'issues' in zodError) {
        this.logger.error(
          `[Zod] issues: ${JSON.stringify((zodError as { issues: unknown }).issues)}`,
        )
        zodIssuesLogged = true
      }

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>
        // 兼容 nestjs-zod v5: issues 在 responseObj.issues 字段
        // （v4 及更早版本可能放在 message 数组里）
        // 出于安全考虑：不向客户端回传字段名和规则，仅统一提示
        if (Array.isArray(responseObj.issues)) {
          if (!zodIssuesLogged) {
            this.logger.error(`[Zod] issues: ${JSON.stringify(responseObj.issues)}`)
          }
          message = '参数校验失败'
        } else if (Array.isArray(responseObj.message)) {
          // 兼容 nestjs-zod v4 及更早版本：issues 在 message 数组里
          if (!zodIssuesLogged) {
            this.logger.error(`[Zod] issues: ${JSON.stringify(responseObj.message)}`)
          }
          message = '参数校验失败'
        } else {
          message = (responseObj.message as string) || exception.message
        }
      } else {
        message = exception.message
      }

      // 5xx 入库；401/403/429 安全相关（爆破/越权/限流）也入库，其余 4xx 不记
      shouldRecordToDb = status >= 500 || status === 401 || status === 403 || status === 429
    } else if (exception instanceof Error) {
      // L3：PG 数值越界（cause code 22003，如 :id 超 int4）集中转 400，一处收全部
      const pgCode = (exception as { cause?: { code?: string } }).cause?.code
      if (pgCode === '22003') {
        status = HttpStatus.BAD_REQUEST
        message = '参数数值超出范围'
      } else {
        // 非业务异常（未捕获的运行时错误）入库
        shouldRecordToDb = true
        this.logger.error(exception.stack || exception.message)
      }
    }

    // 先写文件日志兜底（无论 DB 是否成功都不丢）
    if (shouldRecordToDb) {
      const stack = exception instanceof Error ? exception.stack : undefined
      // R10：cause 链（如 ENOENT/EACCES）进入日志，避免只留外层通用文案而丢失底层故障码
      const causeChain = describeCauseChain(exception)
      const logStack = causeChain
        ? `${stack ?? ''}${stack ? '\n' : ''}[cause] ${causeChain}`
        : stack
      // L18 对齐：文件日志与 DB 落库同口径剥离 query，避免敏感参数进主机日志
      appendErrorLog(
        sanitizeLogText(`${request.method} ${request.url?.split('?')[0]} [${status}] ${message}`),
        logStack,
      )
    }

    // 异步入库错误日志（不阻塞响应），白名单过滤与缓存交给 ErrorLogsService
    if (shouldRecordToDb) {
      this.recordErrorLog(exception, request, status).catch((err) => {
        this.logger.error('[ErrorLogs] 入库失败:', err)
      })
    }

    response.status(status).json({
      code: status,
      message,
      data: null,
    })
  }

  /**
   * 委托给 ErrorLogsService.record() 入库
   * - 自动补 source: 'backend' / errorType: 'http_error'
   * - 复用 Redis 白名单缓存
   */
  private async recordErrorLog(
    exception: unknown,
    request: Request,
    status?: number,
  ): Promise<void> {
    const message = sanitizeLogText(
      exception instanceof Error ? exception.message : String(exception),
    )
    const stack = exception instanceof Error ? exception.stack : undefined
    // R10：cause 链（如 ENOENT/EACCES）进入 DB 错误日志，否则只剩外层"校验失败"无故障码
    const causeChain = describeCauseChain(exception)
    const logStack = causeChain ? `${stack ?? ''}${stack ? '\n' : ''}[cause] ${causeChain}` : stack

    const userPayload = (request as { user?: { sub?: number } }).user
    const ip = (request.ip ?? '') as string

    await this.errorLogsService.record({
      message,
      stack: logStack,
      statusCode: status,
      // L4：url 按 DB 列宽 500 截断（超长 url 否则 22001 被吞，审计消音）
      url: request.url?.slice(0, 500),
      method: request.method?.slice(0, 10),
      context: {
        method: request.method,
        url: request.url?.slice(0, 500),
        body: (request as { sanitizedBody?: unknown }).sanitizedBody ?? request.body,
      },
      userId: userPayload?.sub,
      ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })
  }
}
