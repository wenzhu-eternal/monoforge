import { Reflector } from '@nestjs/core'
import { firstValueFrom, type Observable, of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { ErrorLogsController } from '@/modules/error-logs/error-logs.controller'
import { AuditInterceptor, sanitizeNewValue } from './audit.interceptor'

const MASKED = '***MASKED***'

describe('intercept 方法白名单（M2）', () => {
  it('GET 直接放行（原样返回 next.handle），PUT 进入审计管道落审计', async () => {
    const reflector = { get: vi.fn().mockReturnValue(undefined) }
    const record = vi.fn().mockResolvedValue(undefined)
    const interceptor = new AuditInterceptor(reflector as never, { record } as never)

    const makeCtx = (method: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ method, headers: {}, params: {}, ip: '127.0.0.1' }),
        }),
        getHandler: () => function handler() {},
        getClass: () => ({ name: 'RolePermissionsController' }),
      }) as never

    // GET：早退路径，返回的就是 next.handle() 本身（同一 Observable 引用）
    const nextGet = { handle: vi.fn(() => of('ok')) }
    const getResult = interceptor.intercept(makeCtx('GET'), nextGet as never)
    expect(getResult).toBe(nextGet.handle.mock.results[0].value)
    expect(record).not.toHaveBeenCalled()

    // PUT：全仓唯一 PUT 端点是 role-permissions 权限洗牌，必须落审计且 action/resource 正确映射
    const nextPut = { handle: vi.fn(() => of({ data: { message: 'ok' } })) }
    const putResult = interceptor.intercept(makeCtx('PUT'), nextPut as never) as Observable<unknown>
    await firstValueFrom(putResult)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0][0]).toMatchObject({ action: '更新', resource: '角色权限' })
  })

  it('L12：@SkipAudit() 标注的处理器跳过审计（直接引用真实 reportError，验证生产接线）', async () => {
    const reflector = new Reflector()
    const record = vi.fn().mockResolvedValue(undefined)
    const interceptor = new AuditInterceptor(reflector, { record } as never)

    // 不实例化控制器，只取原型方法——元数据在类定义时已由装饰器写入
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', headers: {}, params: {}, ip: '127.0.0.1' }),
      }),
      getHandler: () => ErrorLogsController.prototype.reportError,
      getClass: () => ErrorLogsController,
    } as never

    const next = { handle: vi.fn(() => of({ data: {} })) }
    const result = interceptor.intercept(ctx, next as never) as Observable<unknown>
    expect(await firstValueFrom(result)).toEqual({ data: {} })
    expect(record).not.toHaveBeenCalled()
  })
})

describe('sanitizeNewValue 响应脱敏（H2/N4）', () => {
  it('N4 复现：登录响应 user 嵌套对象中的 email/phone 与顶层 accessToken 均被掩码', () => {
    const result = sanitizeNewValue(
      {
        accessToken: 'jwt-token',
        user: { id: 1, username: 'alice', email: 'a@x.com', phone: '13800138000' },
      },
      'AuthController',
    ) as Record<string, unknown>

    expect(result.accessToken).toBe(MASKED)
    const user = result.user as Record<string, unknown>
    expect(user.email).toBe(MASKED)
    expect(user.phone).toBe(MASKED)
    expect(user.username).toBe('alice')
  })

  it('深层嵌套与数组元素中的敏感字段同样掩码', () => {
    const result = sanitizeNewValue(
      {
        data: { profile: { wechatOpenId: 'wx-123' } },
        list: [{ email: 'b@x.com' }, { id: 2 }],
      },
      'AuthController',
    ) as Record<string, unknown>

    const data = result.data as Record<string, unknown>
    const profile = data.profile as Record<string, unknown>
    expect(profile.wechatOpenId).toBe(MASKED)
    const list = result.list as Array<Record<string, unknown>>
    expect(list[0]?.email).toBe(MASKED)
    expect(list[1]?.id).toBe(2)
  })

  it('UsersController 表级规则（password 等）在任意层级生效', () => {
    const result = sanitizeNewValue(
      { password: 'plain', email: 'c@x.com', nickname: 'ok' },
      'UsersController',
    ) as Record<string, unknown>

    expect(result.password).toBe(MASKED)
    expect(result.email).toBe(MASKED)
    expect(result.nickname).toBe('ok')
  })

  it('非敏感字段与原始结构原样保留', () => {
    const input = { id: 3, total: 10, flag: true, nested: { keep: 'v' } }
    expect(sanitizeNewValue(input, 'AuthController')).toEqual(input)
  })

  it('超过深度上限的原样返回（防御循环引用），浅层仍正常掩码', () => {
    const deep = { l6: { email: 'd@x.com' } } as Record<string, unknown>
    let cursor: Record<string, unknown> = deep
    for (let i = 0; i < 8; i++) {
      cursor.next = {}
      cursor = cursor.next as Record<string, unknown>
    }
    const result = sanitizeNewValue(deep, 'AuthController') as Record<string, unknown>
    // 第一层仍在扫描范围内，deep.email 命中掩码不受深对象影响
    const l6 = result.l6 as Record<string, unknown>
    expect(l6.email).toBe(MASKED)
  })

  it('循环引用对象不栈溢出（深度上限止损），浅层敏感字段仍掩码', () => {
    const cyclic: Record<string, unknown> = { email: 'e@x.com', username: 'eve' }
    cyclic.self = cyclic
    // scrub 依赖深度上限在 5 层内停止递归，绝不能 RangeError: Maximum call stack
    const result = sanitizeNewValue(cyclic, 'AuthController') as Record<string, unknown>
    expect(result.email).toBe(MASKED)
    expect(result.username).toBe('eve')
    const level2 = result.self as Record<string, unknown>
    expect(level2.email).toBe(MASKED)
  })

  it('null/undefined 与非对象输入原样返回', () => {
    expect(sanitizeNewValue(undefined, 'AuthController')).toBeUndefined()
    expect(sanitizeNewValue(null, 'AuthController')).toBeNull()
  })
})
