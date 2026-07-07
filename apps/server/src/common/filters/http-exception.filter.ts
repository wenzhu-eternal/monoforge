import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { appendErrorLog } from '@/common/logger'
import { ErrorLogsService } from '@/modules/error-logs/error-logs.service'

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

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const exceptionResponse = exception.getResponse()

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>
        // 兼容 nestjs-zod v5: issues 在 responseObj.issues 字段
        // （v4 及更早版本可能放在 message 数组里）
        if (Array.isArray(responseObj.issues)) {
          const issues = responseObj.issues as Array<{ message?: string; path?: unknown[] }>
          message =
            issues
              .map((i) => {
                const field = i.path?.length ? `${String(i.path[i.path.length - 1])}: ` : ''
                return field + (i.message ?? '')
              })
              .filter(Boolean)
              .join('; ') || exception.message
        } else if (Array.isArray(responseObj.message)) {
          const issues = responseObj.message as Array<{ message?: string }>
          message =
            issues
              .map((i) => i.message)
              .filter(Boolean)
              .join('; ') || exception.message
        } else {
          message = (responseObj.message as string) || exception.message
        }
      } else {
        message = exception.message
      }

      // 5xx 错误入库（4xx 视为客户端错误，不记录）
      shouldRecordToDb = status >= 500
    } else if (exception instanceof Error) {
      // 非业务异常（未捕获的运行时错误）入库
      shouldRecordToDb = true
      this.logger.error(exception.stack || exception.message)
    }

    // 先写文件日志兜底（无论 DB 是否成功都不丢）
    if (shouldRecordToDb) {
      const stack = exception instanceof Error ? exception.stack : undefined
      appendErrorLog(`${request.method} ${request.url} [${status}] ${message}`, stack)
    }

    // 异步入库错误日志（不阻塞响应），白名单过滤与缓存交给 ErrorLogsService
    if (shouldRecordToDb) {
      this.recordErrorLog(exception, request).catch((err) => {
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
  private async recordErrorLog(exception: unknown, request: Request): Promise<void> {
    const message = exception instanceof Error ? exception.message : String(exception)
    const stack = exception instanceof Error ? exception.stack : undefined

    const userPayload = (request as { user?: { sub?: number } }).user
    const forwardedFor = request.headers['x-forwarded-for'] as string | undefined
    const ip = forwardedFor?.split(',')[0]?.trim() ?? request.ip

    await this.errorLogsService.record({
      message,
      stack,
      context: {
        method: request.method,
        url: request.url,
        body: (request as { sanitizedBody?: unknown }).sanitizedBody ?? request.body,
      },
      userId: userPayload?.sub,
      ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })
  }
}
