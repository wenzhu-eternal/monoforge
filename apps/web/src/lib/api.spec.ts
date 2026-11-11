import { ErrorCodes, ErrorMessages, type User } from '@shared'
import axios, {
  AxiosError,
  type AxiosError as AxiosErrorType,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/auth-store'
import { type ApiRequestConfig, api, bootstrapAuth, refreshAccessToken } from './api'

const AT_KEY = 'monoforge-auth-refresh-at'
const RT_KEY = 'monoforge-auth-refresh-token'

// L11：无 Web Locks 环境的跨 tab 刷新兜底——jsdom 无 navigator.locks，用例强制确保缺失
describe('L11：无 Web Locks 时刷新失败后二次检查共享键', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useAuthStore.setState({ token: null })
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('本方 401 但他 tab 已刷新 → 500ms 后采用共享 token（不再无差别登出）', async () => {
    vi.useFakeTimers()
    vi.spyOn(axios, 'post').mockRejectedValue(
      Object.assign(new Error('401'), { response: { status: 401 } }),
    )
    // 模拟他 tab 在本方失败后 100ms 完成刷新（写共享键）
    setTimeout(() => {
      localStorage.setItem(AT_KEY, String(Date.now()))
      localStorage.setItem(RT_KEY, 'shared-token')
    }, 100)

    const promise = refreshAccessToken(Date.now() - 1000)
    await vi.advanceTimersByTimeAsync(600)

    await expect(promise).resolves.toBe('shared-token')
    expect(useAuthStore.getState().token).toBe('shared-token')
  })

  it('失败且无他 tab 结果 → 等待后仍抛原错误', async () => {
    vi.useFakeTimers()
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('boom'))

    const promise = refreshAccessToken(Date.now() - 1000)
    const assertion = expect(promise).rejects.toThrow('boom')
    await vi.advanceTimersByTimeAsync(600)
    await assertion
  })

  it('他 tab 刷新早于本次 issuedAt（陈旧结果）→ 不采用，仍抛原错误', async () => {
    vi.useFakeTimers()
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('stale'))
    // 他 tab 的完成时刻早于本方 issuedAt——不能覆盖本方需要的新刷新
    localStorage.setItem(AT_KEY, String(Date.now() - 10_000))
    localStorage.setItem(RT_KEY, 'old-token')

    const promise = refreshAccessToken(Date.now() - 1000)
    const assertion = expect(promise).rejects.toThrow('stale')
    await vi.advanceTimersByTimeAsync(600)
    await assertion
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('M4：refresh 返回 MUST_CHANGE_PASSWORD 401 → 抛错（由拦截器捕获并跳 /change-password）', async () => {
    const mustChangeMsg = ErrorMessages[ErrorCodes.MUST_CHANGE_PASSWORD]
    // 直接构造 axios 401 response（不依赖 fake timers，避免 unhandled rejection 误报）
    const axiosError = Object.assign(new Error('api-refresh-401'), {
      isAxiosError: true,
      response: { status: 401, data: { message: mustChangeMsg } },
    }) as AxiosErrorType<{ message?: string }>
    vi.spyOn(axios, 'post').mockRejectedValue(axiosError)

    // 消费 rejection，避免 vitest unhandled rejection 检测误报
    const promise = refreshAccessToken(Date.now() - 1000)
    void promise.catch(() => undefined)

    // 断言：错误消息透传（拦截器 catch 分支负责路由跳转 /change-password）
    await expect(promise).rejects.toThrow('api-refresh-401')
    // 未调用 setToken（token 未变，清态由拦截器负责）
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('Q1：Web Locks API 自身抛错 → 回落 L11 的 500ms 共享键二查', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockRejectedValue(new DOMException('lock denied', 'SecurityError'))
    Object.defineProperty(navigator, 'locks', {
      value: { request },
      configurable: true,
    })
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('lock fallback refresh failed'))
    setTimeout(() => {
      localStorage.setItem(AT_KEY, String(Date.now()))
      localStorage.setItem(RT_KEY, 'shared-after-lock-error')
    }, 100)

    const promise = refreshAccessToken(Date.now() - 1000)
    await vi.advanceTimersByTimeAsync(600)

    await expect(promise).resolves.toBe('shared-after-lock-error')
    expect(request).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().token).toBe('shared-after-lock-error')
  })
})

describe('L26：锁回调已执行后失败 → 保留真实刷新错误', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useAuthStore.setState({ token: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('callbackStarted=true 时按原错误立即落定，不回落共享键', async () => {
    vi.useFakeTimers()
    const refreshError = new Error('callback-true-refresh-failed')
    const request = vi.fn(async (_name: string, cb: () => Promise<string>) => cb())
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    // 刷新请求在回调内失败，同时写入"他 tab 已刷新"的共享键——若错误回落二查会被误采用
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      localStorage.setItem(AT_KEY, String(Date.now()))
      localStorage.setItem(RT_KEY, 'stale-shared-token')
      throw refreshError
    })

    const promise = refreshAccessToken(Date.now() - 1000)
    const assertion = expect(promise).rejects.toThrow('callback-true-refresh-failed')
    // 若错误地进入回落分支，500ms 后会采用共享 token 并 resolve
    await vi.advanceTimersByTimeAsync(600)
    await assertion
    expect(request).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().token).toBeNull()
  })
})

describe('P2-03：会话代次隔离', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useAuthStore.setState({ token: null, isAuthenticated: false, user: null, sessionEpoch: 0 })
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('旧会话刷新成功晚到 → 作废，不覆盖新登录 token', async () => {
    vi.useFakeTimers()
    useAuthStore.setState({ token: 'old-token', isAuthenticated: true, sessionEpoch: 1 })
    let resolvePost: (value: unknown) => void = () => undefined
    vi.spyOn(axios, 'post').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        }),
    )

    const promise = refreshAccessToken(Date.now() - 1000, 1)
    const assertion = expect(promise).rejects.toThrow('会话已切换')
    // 刷新在途期间重新登录（同账号也算新会话）
    useAuthStore.getState().login({ id: 9 } as User, 'new-token')
    resolvePost({ data: { data: { accessToken: 'stale-token' } } })
    await vi.advanceTimersByTimeAsync(600)
    await assertion

    expect(useAuthStore.getState().token).toBe('new-token')
  })

  it('旧会话业务请求 401 晚到 → 不触发刷新、不清态、不跳转', async () => {
    useAuthStore.setState({ token: 'old-token', isAuthenticated: true, sessionEpoch: 1 })
    useAuthStore.getState().login({ id: 9 } as User, 'new-token')
    const post = vi.spyOn(axios, 'post')
    const adapter = async (config: InternalAxiosRequestConfig) => {
      // 模拟该请求在旧会话（代次 1）发出，新登录后才收到 401
      ;(config as ApiRequestConfig)._sessionEpoch = 1
      throw new AxiosError('old 401', 'ERR_BAD_REQUEST', config, undefined, {
        status: 401,
        statusText: '',
        headers: {},
        config,
        data: {},
      })
    }

    await expect(api.get('/api/v1/users', { adapter })).rejects.toThrow('会话已切换')

    expect(post).not.toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBe('new-token')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('旧会话刷新失败晚到 → 不中断已切换的新会话', async () => {
    vi.useFakeTimers()
    useAuthStore.setState({ token: 'old-token', isAuthenticated: true, sessionEpoch: 1 })
    let rejectPost: (reason: unknown) => void = () => undefined
    vi.spyOn(axios, 'post').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPost = reject
        }),
    )

    const promise = refreshAccessToken(Date.now() - 1000, 1)
    const assertion = expect(promise).rejects.toThrow('refresh failed')
    useAuthStore.getState().login({ id: 9 } as User, 'new-token')
    rejectPost(new Error('refresh failed'))
    await vi.advanceTimersByTimeAsync(600)
    await assertion

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().token).toBe('new-token')
  })
})

describe('② 刷新单飞与 bootstrapAuth 行为锁', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useAuthStore.setState({ token: null, isAuthenticated: false, user: null })
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('M9：同 tab 并发调用共享同一 in-flight（refresh 只发一次）', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { accessToken: 'dedup-token' } },
    })

    const [a, b] = await Promise.all([refreshAccessToken(1), refreshAccessToken(1)])

    expect(a).toBe('dedup-token')
    expect(b).toBe('dedup-token')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('M11：Web Locks 主路径串行执行回调并落定', async () => {
    const request = vi.fn(async (_name: string, cb: () => Promise<string>) => cb())
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { accessToken: 'lock-token' } },
    })

    await expect(refreshAccessToken(Date.now() - 1000)).resolves.toBe('lock-token')
    expect(request).toHaveBeenCalledWith('monoforge-auth-refresh', expect.any(Function))
  })

  it('M11：等锁期间他 tab 已完成刷新 → 复用共享 token，不再消费 refresh cookie', async () => {
    const request = vi.fn(async (_name: string, cb: () => Promise<string>) => cb())
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    localStorage.setItem(AT_KEY, String(Date.now()))
    localStorage.setItem(RT_KEY, 'shared-fresh-token')
    const post = vi.spyOn(axios, 'post')

    await expect(refreshAccessToken(Date.now() - 5000)).resolves.toBe('shared-fresh-token')
    expect(post).not.toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBe('shared-fresh-token')
  })

  it('bootstrapAuth：已认证但 token 为空 → 用 cookie 刷新写回 token', async () => {
    useAuthStore.setState({ token: null, isAuthenticated: true })
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { accessToken: 'boot-token' } },
    })

    await bootstrapAuth()

    expect(useAuthStore.getState().token).toBe('boot-token')
  })

  it('bootstrapAuth：未认证或已有 token → 不发刷新请求', async () => {
    const post = vi.spyOn(axios, 'post')

    useAuthStore.setState({ token: null, isAuthenticated: false })
    await bootstrapAuth()
    useAuthStore.setState({ token: 'existing', isAuthenticated: true })
    await bootstrapAuth()

    expect(post).not.toHaveBeenCalled()
  })

  it('bootstrapAuth：刷新失败 → 清态兜底（不残留半登录态）', async () => {
    useAuthStore.setState({ token: null, isAuthenticated: true })
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh failed'))

    await bootstrapAuth()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().token).toBeNull()
  })
})
