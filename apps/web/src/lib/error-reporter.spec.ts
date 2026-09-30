import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    post: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

import type { ReportError } from '@shared'
import { reportFrontendError } from '@/lib/error-reporter'

function lastPostBody() {
  return apiMock.post.mock.calls[0]?.[1] as Record<string, unknown>
}

describe('reportFrontendError context 截断（M7）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('非字符串大对象超 10KB 时兜底整体截断，仍可入库检索（M7 残余复现）', async () => {
    // 巨大嵌套对象：字符串截断分支对它无效，原实现会导致后端 400 静默丢弃
    const hugeNested = {
      rows: Array.from({ length: 400 }, (_, i) => ({ idx: i, blob: 'x'.repeat(80) })),
    }
    await reportFrontendError({
      source: 'frontend',
      errorType: 'js_error',
      message: '测试错误',
      context: { body: hugeNested },
    } as ReportError)

    const context = lastPostBody().context as Record<string, unknown>
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(10240)
    expect(context.__truncated).toBe(true)
    expect(typeof context.raw).toBe('string')
    // 兜底 raw 保留原始内容的可检索片段
    expect(context.raw).toContain('rows')
  })

  it('超长字符串值截断到 500 且标记 __truncated', async () => {
    await reportFrontendError({
      source: 'frontend',
      errorType: 'js_error',
      message: '测试错误',
      context: { longStr: 'y'.repeat(20000), keep: 'ok' },
    } as ReportError)

    const context = lastPostBody().context as Record<string, unknown>
    expect((context.longStr as string).length).toBe(500)
    expect(context.__truncated).toBe(true)
    expect(context.keep).toBe('ok')
  })

  it('小 context 原样传递不截断', async () => {
    await reportFrontendError({
      source: 'frontend',
      errorType: 'js_error',
      message: '测试错误',
      context: { code: 42 },
    } as ReportError)

    const context = lastPostBody().context as Record<string, unknown>
    expect(context).toEqual({ code: 42 })
  })

  it('message/stack/file/url/method 按后端列宽截断', async () => {
    await reportFrontendError({
      source: 'frontend',
      errorType: 'js_error',
      message: 'm'.repeat(3000),
      stack: 's'.repeat(4000),
      file: 'f'.repeat(600),
      url: 'u'.repeat(600),
      method: 'POSTMETHOD',
    } as unknown as ReportError)

    const body = lastPostBody()
    expect((body.message as string).length).toBe(2000)
    expect((body.stack as string).length).toBe(3000)
    expect((body.file as string).length).toBe(500)
    expect((body.url as string).length).toBe(500)
    expect((body.method as string).length).toBe(10)
  })
})
