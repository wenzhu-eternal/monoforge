import { describe, expect, it } from 'vitest'
import { HttpClientService } from './http-client.service'

// 固定 500 的 fake adapter：错误对象携带 axios 请求 config，重试链路可用
function failingAdapter(calls: { count: number }) {
  return async (config: unknown) => {
    calls.count += 1
    const err = new Error('Request failed with status code 500') as Error & {
      config: unknown
      response: { status: number }
    }
    err.config = config
    err.response = { status: 500 }
    throw err
  }
}

describe('HttpClientService per-request 重试覆盖（M2）', () => {
  it('maxRetries: 0 → 只请求 1 次，不重试', async () => {
    const service = new HttpClientService()
    const instance = service.createInstance({ retryBaseDelay: 1 })
    const calls = { count: 0 }

    await expect(
      service.get(instance, '/x', { adapter: failingAdapter(calls), maxRetries: 0 } as never),
    ).rejects.toThrow()
    expect(calls.count).toBe(1)
  })

  it('retryOn5xx: false → 不重试', async () => {
    const service = new HttpClientService()
    const instance = service.createInstance({ retryBaseDelay: 1 })
    const calls = { count: 0 }

    await expect(
      service.get(instance, '/x', { adapter: failingAdapter(calls), retryOn5xx: false } as never),
    ).rejects.toThrow()
    expect(calls.count).toBe(1)
  })

  it('缺省时仍按实例默认重试（1 + 2 次）', async () => {
    const service = new HttpClientService()
    const instance = service.createInstance({ retryBaseDelay: 1 })
    const calls = { count: 0 }

    await expect(
      service.get(instance, '/x', { adapter: failingAdapter(calls) } as never),
    ).rejects.toThrow()
    expect(calls.count).toBe(3)
  })
})
