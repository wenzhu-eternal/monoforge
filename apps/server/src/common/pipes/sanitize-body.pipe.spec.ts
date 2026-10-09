import type { ArgumentMetadata } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { UpdateUserDto } from '@/modules/users/dto/update-user.dto'
import { SanitizeBodyPipe } from './sanitize-body.pipe'

describe('SanitizeBodyPipe', () => {
  const pipe = new SanitizeBodyPipe()
  const meta = (metatype?: unknown): ArgumentMetadata => ({
    type: 'body',
    metatype: metatype as ArgumentMetadata['metatype'],
    data: '',
  })

  it('H2: UpdateUserDto 的 roleId null 被保留（解绑角色不被吞成未改动）', () => {
    const out = pipe.transform({ roleId: null, nickname: 'n' }, meta(UpdateUserDto)) as Record<
      string,
      unknown
    >
    expect(out.roleId).toBeNull()
    expect(out.nickname).toBe('n')
  })

  it('H2: 非 nullable 字段的 null 仍转 undefined（保持原有 optional 匹配语义）', () => {
    const out = pipe.transform({ email: null, nickname: null }, meta(UpdateUserDto)) as Record<
      string,
      unknown
    >
    expect(out.email).toBeUndefined()
    expect(out.nickname).toBeUndefined()
  })

  it('无 metatype（非 DTO body）时退回原行为：null 全转 undefined', () => {
    const out = pipe.transform({ a: null }, meta(undefined)) as Record<string, unknown>
    expect(out.a).toBeUndefined()
  })

  it('非对象/数组/null 输入原样返回', () => {
    expect(pipe.transform(null)).toBeNull()
    expect(pipe.transform([1, null])).toEqual([1, null])
    expect(pipe.transform('x')).toBe('x')
  })
})
