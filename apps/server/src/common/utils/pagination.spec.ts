import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { parsePagination, parseQueryText } from './pagination'

describe('parsePagination（L6 整数串严格校验）', () => {
  it('缺省值：page=1、pageSize=10', () => {
    expect(parsePagination()).toEqual({ page: 1, pageSize: 10 })
  })

  it('合法数字串正常解析', () => {
    expect(parsePagination('3', '20')).toEqual({ page: 3, pageSize: 20 })
  })

  it('L6：12abc 不再被 parseInt 静默截成 12，直接 400', () => {
    expect(() => parsePagination('12abc')).toThrow(BadRequestException)
    expect(() => parsePagination('3', '10x')).toThrow(BadRequestException)
  })

  it('负数/小数/空白 400', () => {
    expect(() => parsePagination('-1')).toThrow(BadRequestException)
    expect(() => parsePagination('1.5')).toThrow(BadRequestException)
    expect(() => parsePagination(' ')).toThrow(BadRequestException)
  })

  it('超 schema 上限仍 400（pageSize 上限由 PaginationQuerySchema 约束）', () => {
    expect(() => parsePagination('1', '9999')).toThrow(BadRequestException)
  })
})

describe('parseQueryText', () => {
  it('超长文本 400', () => {
    expect(() => parseQueryText('x'.repeat(201), 'keyword')).toThrow(BadRequestException)
  })

  it('未传返回 undefined', () => {
    expect(parseQueryText(undefined, 'keyword')).toBeUndefined()
  })
})
