import {
  ArgumentsHost,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import multer from 'multer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendErrorLog } from '@/common/logger'
import { ErrorLogsService } from '@/modules/error-logs/error-logs.service'
import { HttpExceptionFilter } from './http-exception.filter'

vi.mock('@/common/logger', () => ({
  appendErrorLog: vi.fn(),
}))

type MockResponse = {
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
}

function createHost(request: Record<string, unknown>) {
  const res: MockResponse = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost
  return { host, res }
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter
  let errorLogsService: { record: ReturnType<typeof vi.fn> }
  const baseRequest = { method: 'POST', url: '/api/v1/files', ip: '127.0.0.1', headers: {} }

  beforeEach(() => {
    vi.clearAllMocks()
    errorLogsService = { record: vi.fn().mockResolvedValue(undefined) }
    filter = new HttpExceptionFilter(errorLogsService as unknown as ErrorLogsService)
  })

  it('M3：MulterError → 413，不入库不写文件日志（原嵌 HttpException 分支内为死代码，恒 500）', () => {
    const err = new multer.MulterError('LIMIT_FILE_SIZE')
    const { host, res } = createHost({ ...baseRequest, body: { file: 'x' } })

    filter.catch(err, host)

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith({
      code: 413,
      message: '文件过大，请上传 10MB 以内的文件',
      data: null,
    })
    expect(errorLogsService.record).not.toHaveBeenCalled()
    expect(appendErrorLog).not.toHaveBeenCalled()
  })

  it('L14：非 LIMIT_FILE_SIZE 的 MulterError（字段名错等）→ 400 + 原始 code，不复用 413', () => {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE')
    const { host, res } = createHost({ ...baseRequest, body: {} })

    filter.catch(err, host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      code: 400,
      message: '文件上传参数错误: LIMIT_UNEXPECTED_FILE',
      data: null,
    })
    expect(errorLogsService.record).not.toHaveBeenCalled()
  })

  it('HttpException 400 → 透传状态与消息，不入库（其余 4xx 不记）', () => {
    const { host, res } = createHost({ ...baseRequest, body: {} })

    filter.catch(new BadRequestException('参数校验失败'), host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ code: 400, message: '参数校验失败', data: null })
    expect(errorLogsService.record).not.toHaveBeenCalled()
  })

  it('HttpException 401 → 入库（安全事件不可消音）', () => {
    const { host } = createHost({ ...baseRequest, body: {} })

    filter.catch(new UnauthorizedException('未登录'), host)

    expect(errorLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    )
  })

  it('未知运行时错误 → 500 + 入库 + 文件日志兜底', () => {
    const { host, res } = createHost({ ...baseRequest, body: {} })

    filter.catch(new Error('boom'), host)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ code: 500, message: '服务器内部错误', data: null })
    expect(errorLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'boom' }),
    )
    expect(appendErrorLog).toHaveBeenCalledTimes(1)
  })

  it('PG 22003 数值越界（cause code）→ 400，不入库', () => {
    const err = Object.assign(new Error('value out of range'), {
      cause: { code: '22003' },
    })
    const { host, res } = createHost({ ...baseRequest, body: {} })

    filter.catch(err, host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(errorLogsService.record).not.toHaveBeenCalled()
  })

  it('R10：500 异常带 Error cause（ENOENT）→ 文件与 DB 错误日志含底层故障码', () => {
    const cause = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    const err = new InternalServerErrorException('文件内容校验失败，请稍后重试', { cause })
    const { host } = createHost({ ...baseRequest, body: {} })

    filter.catch(err, host)

    expect(errorLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: '文件内容校验失败，请稍后重试',
        stack: expect.stringContaining('[cause] ENOENT'),
      }),
    )
    expect(appendErrorLog).toHaveBeenCalledWith(
      expect.stringContaining('[500]'),
      expect.stringContaining('[cause] ENOENT'),
    )
  })

  it('R10：非 Error cause（字符串）→ 有界抽取进入日志', () => {
    const err = new InternalServerErrorException('文件读取失败，无法完成安全扫描', {
      cause: 'disk full',
    })
    const { host } = createHost({ ...baseRequest, body: {} })

    filter.catch(err, host)

    expect(errorLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        stack: expect.stringContaining('[cause] disk full'),
      }),
    )
  })

  it('R10：循环 cause → 不无限展开', () => {
    const cause = new Error('loop') as Error & { cause?: unknown }
    cause.cause = cause
    const err = new InternalServerErrorException('x', { cause })
    const { host } = createHost({ ...baseRequest, body: {} })

    filter.catch(err, host)

    expect(errorLogsService.record).toHaveBeenCalled()
  })

  it('H01：异常 message 含凭证 → 脱敏后入库，不泄露明文', () => {
    const err = new Error('login failed password=supersecret123 token=abc.def.ghi')
    const { host } = createHost({ ...baseRequest, body: {} })

    filter.catch(err, host)

    const recordArg = errorLogsService.record.mock.calls[0][0] as { message: string }
    expect(recordArg.message).toContain('password=***REDACTED***')
    expect(recordArg.message).toContain('token=***REDACTED***')
    expect(recordArg.message).not.toContain('supersecret123')
    expect(recordArg.message).not.toContain('abc.def.ghi')
  })

  it('H01：超长异常 message → 截断，不整串落库', () => {
    const err = new Error(`boom ${'x'.repeat(5000)}`)
    const { host } = createHost({ ...baseRequest, body: {} })

    filter.catch(err, host)

    const recordArg = errorLogsService.record.mock.calls[0][0] as { message: string }
    expect(recordArg.message.length).toBeLessThan(2100)
    expect(recordArg.message).toContain('(truncated)')
  })
})
