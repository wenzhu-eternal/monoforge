import { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import { CreateWhitelistDto } from '@/modules/error-logs/dto/create-whitelist.dto'
import { ReportErrorDto } from '@/modules/error-logs/dto/report-error.dto'
import { UpdateWhitelistDto } from '@/modules/error-logs/dto/update-whitelist.dto'
import { XssPipe } from '../pipes/xss.pipe'

describe('XssPipe（L8 豁免）', () => {
  const pipe = new XssPipe(new Reflector())

  it('普通 DTO 的字符串仍剥 HTML 标签', () => {
    class PlainDto {}
    const result = pipe.transform(
      { content: 'a <script>alert(1)</script> b' },
      { type: 'body', metatype: PlainDto, data: '' },
    ) as { content: string }

    expect(result.content).not.toContain('<script>')
  })

  it('SkipXss：真实 @SkipXss() DTO（错误上报/白名单）原样返回，原文不失真', () => {
    for (const metatype of [ReportErrorDto, CreateWhitelistDto, UpdateWhitelistDto]) {
      const raw = { message: 'Unexpected token <script>', pattern: '<svg onload=' }
      const result = pipe.transform(raw, { type: 'body', metatype, data: '' })
      expect(result).toBe(raw)
    }
  })

  it('reflector 无元数据时按普通清洗处理（防御）', () => {
    const reflector = { get: vi.fn().mockReturnValue(undefined) }
    const localPipe = new XssPipe(reflector as never)
    const result = localPipe.transform('x <b>y</b>', {
      type: 'body',
      metatype: Object,
      data: '',
    }) as string

    expect(reflector.get).toHaveBeenCalled()
    expect(result).not.toContain('<b>')
  })
})
