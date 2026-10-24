import { ErrorCodes, ErrorMessages } from '@shared'
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/auth-store'
import { api, authRedirect } from './api'
import { clearUserScopedState } from './auth-cleanup'

// 拦截器集成测试：真 api 实例 + 假 adapter，让请求/响应拦截器完整执行。
// use-*.spec 全部整体 mock api 导致拦截器主分支零覆盖（上轮 M1/L16/M4 均在此盲区绿灯合入），
// 本 spec 以假 adapter 逐分支锁定 401 处置矩阵。
vi.mock('./auth-cleanup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth-cleanup')>()
  return { ...actual, clearUserScopedState: vi.fn() }
})

const MUST_CHANGE_MSG = ErrorMessages[ErrorCodes.MUST_CHANGE_PASSWORD]

/** 构造带 response 的 401 AxiosError，交由 adapter reject */
function err401(config: InternalAxiosRequestConfig, message = '未登录') {
  return new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, null, {
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
    data: { message },
  } as AxiosResponse)
}

function ok200(config: InternalAxiosRequestConfig, data: unknown = {}): AxiosResponse {
  return { status: 200, statusText: 'OK', headers: {}, config, data }
}

function err403(config: InternalAxiosRequestConfig) {
  return new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST', config, null, {
    status: 403,
    statusText: 'Forbidden',
    headers: {},
    config,
    data: { message: '无权限' },
  } as AxiosResponse)
}

describe('拦截器 401 处置矩阵', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useAuthStore.setState({ token: null })
    vi.mocked(clearUserScopedState).mockClear()
  })

  afterEach(() => {
    api.defaults.adapter = axios.getAdapter(api.defaults.adapter)
    vi.useRealTimers()
  })

  it('M1：登录 401（账密错误）→ 不进刷新链、不触发终态登出，错误透传给表单', async () => {
    const postSpy = vi.spyOn(axios, 'post')
    api.defaults.adapter = async (config) => {
      throw err401(config as InternalAxiosRequestConfig, '用户名或密码错误')
    }

    await expect(api.post('/api/v1/auth/login', {})).rejects.toMatchObject({
      response: { status: 401, data: { message: '用户名或密码错误' } },
    })
    expect(postSpy).not.toHaveBeenCalled()
    expect(clearUserScopedState).not.toHaveBeenCalled()
  })

  it('M1：注册/发码 401（验证码错误等）→ 不进刷新链、不触发终态登出', async () => {
    const postSpy = vi.spyOn(axios, 'post')
    for (const url of ['/api/v1/auth/register', '/api/v1/auth/send-register-code']) {
      api.defaults.adapter = async (config) => {
        throw err401(config as InternalAxiosRequestConfig, '验证码无效或已过期')
      }
      await expect(api.post(url, {})).rejects.toMatchObject({ response: { status: 401 } })
    }
    expect(postSpy).not.toHaveBeenCalled()
    expect(clearUserScopedState).not.toHaveBeenCalled()
  })

  it('正常过期链：业务 401 → 刷新成功 → 重试 200，token 同步', async () => {
    useAuthStore.setState({ token: 'expired-token', isAuthenticated: true })
    let calls = 0
    api.defaults.adapter = async (config) => {
      calls += 1
      if (config.headers?.Authorization === 'Bearer new-token') return ok200(config, { ok: true })
      throw err401(config as InternalAxiosRequestConfig)
    }
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { accessToken: 'new-token' } },
    } as AxiosResponse)

    const res = await api.get('/api/v1/users')
    expect(res.data).toEqual({ ok: true })
    expect(calls).toBe(2)
    expect(useAuthStore.getState().token).toBe('new-token')
    expect(clearUserScopedState).not.toHaveBeenCalled()
  })

  it('刷新失败（普通 401）→ 终态登出（清态）', async () => {
    useAuthStore.setState({ token: 'expired-token', isAuthenticated: true })
    api.defaults.adapter = async (config) => {
      throw err401(config as InternalAxiosRequestConfig)
    }
    vi.spyOn(axios, 'post').mockRejectedValue(
      err401({} as InternalAxiosRequestConfig, 'refresh 失败'),
    )

    await expect(api.get('/api/v1/users')).rejects.toMatchObject({ response: { status: 401 } })
    expect(clearUserScopedState).toHaveBeenCalledTimes(1)
  })

  it('M1：refresh 成功但重试仍 401（_retry）→ 终态登出', async () => {
    useAuthStore.setState({ token: 'expired-token', isAuthenticated: true })
    api.defaults.adapter = async (config) => {
      throw err401(config as InternalAxiosRequestConfig)
    }
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { accessToken: 'new-token' } },
    } as AxiosResponse)

    await expect(api.get('/api/v1/users')).rejects.toMatchObject({ response: { status: 401 } })
    expect(clearUserScopedState).toHaveBeenCalledTimes(1)
  })

  it('M2：refresh 返回 MUST_CHANGE_PASSWORD 401 → 走改密分支，不清态、错误透传', async () => {
    useAuthStore.setState({ token: 'expired-token', isAuthenticated: true })
    api.defaults.adapter = async (config) => {
      throw err401(config as InternalAxiosRequestConfig)
    }
    vi.spyOn(axios, 'post').mockRejectedValue(
      err401({} as InternalAxiosRequestConfig, MUST_CHANGE_MSG),
    )

    await expect(api.get('/api/v1/users')).rejects.toMatchObject({
      response: { status: 401, data: { message: MUST_CHANGE_MSG } },
    })
    // 改密分支与终态登出互斥：clearUserScopedState 未被调用即证明走的是改密分支
    //（location.href 不可 redefine，跳转目标以分支证据断言）
    expect(clearUserScopedState).not.toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBe('expired-token')
  })

  it('L2：refresh 期间登出 → 排队请求立即失败，不重发死 token', async () => {
    useAuthStore.setState({ token: 'expired-token', isAuthenticated: true })
    let resolveRefresh: ((value: AxiosResponse) => void) | undefined
    vi.spyOn(axios, 'post').mockReturnValue(
      new Promise<AxiosResponse>((resolve) => {
        resolveRefresh = resolve
      }) as never,
    )
    let adapterCalls = 0
    api.defaults.adapter = async (config) => {
      adapterCalls += 1
      throw err401(config as InternalAxiosRequestConfig)
    }

    const first = api.get('/api/v1/users')
    const firstAssertion = expect(first).rejects.toThrow('用户已登出，放弃 refresh 重试')
    await vi.waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1))

    const second = api.get('/api/v1/roles')
    const secondAssertion = expect(second).rejects.toThrow('用户已登出，放弃 refresh 重试')
    await vi.waitFor(() => expect(adapterCalls).toBe(2))

    // 模拟刷新在途时用户主动登出
    useAuthStore.setState({ token: null, isAuthenticated: false, user: null })
    resolveRefresh?.({ data: { data: { accessToken: 'dead-token' } } } as AxiosResponse)

    await firstAssertion
    await secondAssertion
    // 两条原始请求各打一次 401，均未带 dead-token 重试
    expect(adapterCalls).toBe(2)
  })

  it('L27：skipAuthFlow 请求 401 → 不进入刷新链，错误直接透传', async () => {
    useAuthStore.setState({ token: 'expired-token', isAuthenticated: true })
    const postSpy = vi.spyOn(axios, 'post')
    api.defaults.adapter = async (config) => {
      throw err401(config as InternalAxiosRequestConfig)
    }

    await expect(api.get('/api/v1/users', { skipAuthFlow: true } as never)).rejects.toMatchObject({
      response: { status: 401 },
    })
    expect(postSpy).not.toHaveBeenCalled()
    expect(clearUserScopedState).not.toHaveBeenCalled()
  })

  it('L27：GET 403 跳 /403；PATCH 403 交由调用方处理', async () => {
    const redirectSpy = vi.spyOn(authRedirect, 'to').mockImplementation(() => undefined)
    const postSpy = vi.spyOn(axios, 'post')
    api.defaults.adapter = async (config) => {
      throw err403(config as InternalAxiosRequestConfig)
    }

    await expect(api.get('/api/v1/users')).rejects.toMatchObject({ response: { status: 403 } })
    expect(redirectSpy).toHaveBeenCalledWith('/403')

    redirectSpy.mockClear()
    await expect(api.patch('/api/v1/users/1', {})).rejects.toMatchObject({
      response: { status: 403 },
    })
    expect(redirectSpy).not.toHaveBeenCalled()
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('L27：GET 403 + skipForbiddenRedirect → 不跳 /403，交由调用方展示', async () => {
    const redirectSpy = vi.spyOn(authRedirect, 'to').mockImplementation(() => undefined)
    api.defaults.adapter = async (config) => {
      throw err403(config as InternalAxiosRequestConfig)
    }

    await expect(
      api.get('/api/v1/dashboard/stats', { skipForbiddenRedirect: true } as never),
    ).rejects.toMatchObject({ response: { status: 403 } })
    expect(redirectSpy).not.toHaveBeenCalled()
  })

  it('L27：业务 401 + MUST_CHANGE_PASSWORD → 前置改密分支，不刷新不清态', async () => {
    useAuthStore.setState({ token: 'valid-token', isAuthenticated: true })
    const redirectSpy = vi.spyOn(authRedirect, 'to').mockImplementation(() => undefined)
    const postSpy = vi.spyOn(axios, 'post')
    api.defaults.adapter = async (config) => {
      throw err401(config as InternalAxiosRequestConfig, MUST_CHANGE_MSG)
    }

    await expect(api.get('/api/v1/users')).rejects.toMatchObject({
      response: { status: 401, data: { message: MUST_CHANGE_MSG } },
    })
    expect(redirectSpy).toHaveBeenCalledWith('/change-password')
    expect(postSpy).not.toHaveBeenCalled()
    expect(clearUserScopedState).not.toHaveBeenCalled()
  })

  it('L27：排队请求 15s 超时 → 中文超时文案', async () => {
    vi.useFakeTimers()
    useAuthStore.setState({ token: 'expired-token', isAuthenticated: true })
    let resolveRefresh: ((value: AxiosResponse) => void) | undefined
    vi.spyOn(axios, 'post').mockReturnValue(
      new Promise<AxiosResponse>((resolve) => {
        resolveRefresh = resolve
      }) as never,
    )
    api.defaults.adapter = async (config) => {
      throw err401(config as InternalAxiosRequestConfig)
    }

    const first = api.get('/api/v1/users')
    void first.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(axios.post).toHaveBeenCalledTimes(1)

    const second = api.get('/api/v1/roles')
    const secondAssertion = expect(second).rejects.toThrow('登录状态刷新超时，请重新登录')
    await vi.advanceTimersByTimeAsync(15_000)
    await secondAssertion

    // 收尾：让首个请求的刷新落定，避免悬挂 promise 影响后续用例
    resolveRefresh?.({ data: { data: { accessToken: 'late-token' } } } as AxiosResponse)
    await vi.advanceTimersByTimeAsync(0)
    await first.catch(() => undefined)
  })
})
