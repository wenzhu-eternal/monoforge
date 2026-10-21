import { ErrorCodes, ErrorMessages } from '@shared'
import axios, { type AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/auth-store'
import { refreshAccessToken } from './api'

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
    }) as AxiosError<{ message?: string }>
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
