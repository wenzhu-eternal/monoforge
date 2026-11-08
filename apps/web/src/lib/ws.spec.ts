import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

// vi.mock 被 hoist：假 socket 存 handlers 供测试触发事件，io 调用计数即建连次数
const { ioMock, sockets } = vi.hoisted(() => {
  const sockets: Array<{
    connected: boolean
    handlers: Map<string, Set<Handler>>
  }> = []
  const ioMock = vi.fn(() => {
    const handlers = new Map<string, Set<Handler>>()
    const socket = {
      connected: false,
      handlers,
      on: (event: string, h: Handler) => {
        if (!handlers.has(event)) handlers.set(event, new Set())
        handlers.get(event)?.add(h)
      },
      off: (event: string, h?: Handler) => {
        if (h) handlers.get(event)?.delete(h)
        else handlers.delete(event)
      },
      removeAllListeners: () => handlers.clear(),
      disconnect: () => {
        socket.connected = false
      },
      emit: () => {},
      io: { on: (_event: string, _h: Handler) => {} },
    }
    sockets.push(socket)
    return socket
  })
  return { ioMock, sockets }
})

vi.mock('socket.io-client', () => ({ io: ioMock }))

import { wsClient } from './ws'

type Socket = (typeof sockets)[number]

function lastSocket(): Socket {
  const s = sockets.at(-1)
  if (!s) throw new Error('no socket created')
  return s
}

function fire(socket: Socket, event: string, ...args: unknown[]): void {
  const handlers = socket.handlers.get(event)
  if (!handlers) return
  for (const h of handlers) h(...args)
}

describe('M2/M3：踢线错误码分流与刷新冷却', () => {
  let refreshHandler: ReturnType<typeof vi.fn>

  let clockBase = 0

  beforeEach(() => {
    // 冷却判定依赖 Date.now()：每次 install 都从严格递增的基准起算，避免跨用例残留的时间戳互拦
    clockBase += 60_000
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      now: Date.now() + clockBase,
    })
    wsClient.disconnect()
    // reconnectAttempts 仅在 connect 事件归零：建一次并触发 connect 再断开
    wsClient.connect('reset')
    fire(sockets.at(-1) as Socket, 'connect')
    wsClient.disconnect()
    ioMock.mockClear()
    sockets.length = 0
    refreshHandler = vi.fn().mockResolvedValue('new-token')
    wsClient.setTokenProvider(() => 'tok', refreshHandler as never)
  })

  afterEach(() => {
    wsClient.disconnect()
    wsClient.setTokenProvider(null)
    vi.useRealTimers()
  })

  it('M2：AUTH_FAILED 踢线只刷新一次（error 与 disconnect 共用冷却）', async () => {
    wsClient.connect('tok')
    fire(lastSocket(), 'error', { code: 'AUTH_FAILED' })
    fire(lastSocket(), 'disconnect', 'io server disconnect')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(refreshHandler).toHaveBeenCalledTimes(1)
    expect(ioMock).toHaveBeenCalledTimes(2)
  })

  it('M2：ACCOUNT_UNAVAILABLE 踢线不换信物，仅重连', async () => {
    wsClient.connect('tok')
    fire(lastSocket(), 'error', { code: 'ACCOUNT_UNAVAILABLE' })
    fire(lastSocket(), 'disconnect', 'io server disconnect')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(refreshHandler).not.toHaveBeenCalled()
    expect(ioMock).toHaveBeenCalledTimes(2)
  })

  it('M3：500ms 内重复鉴权失败走冷却，只刷新一次', async () => {
    wsClient.connect('tok')
    fire(lastSocket(), 'error', { code: 'AUTH_FAILED' })
    await vi.advanceTimersByTimeAsync(500)
    fire(lastSocket(), 'error', { code: 'AUTH_FAILED' })
    await vi.advanceTimersByTimeAsync(500)

    expect(refreshHandler).toHaveBeenCalledTimes(1)
  })

  it('M3：无结构化 code 时文本兜底（token 失效仍换信物）', async () => {
    wsClient.connect('tok')
    fire(lastSocket(), 'error', { message: 'invalid token' })
    await vi.advanceTimersByTimeAsync(100)

    expect(refreshHandler).toHaveBeenCalledTimes(1)
  })

  it('L16：error 已发起刷新时，disconnect 等待在途刷新完成再重连', async () => {
    let resolveRefresh: (v: string | null) => void = () => {}
    refreshHandler.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    wsClient.connect('tok')
    fire(lastSocket(), 'error', { code: 'AUTH_FAILED' })
    fire(lastSocket(), 'disconnect', 'io server disconnect')
    await vi.advanceTimersByTimeAsync(1_000)

    // 刷新在途：不得用旧 token 抢先重连（否则会多被拒一次）
    expect(ioMock).toHaveBeenCalledTimes(1)

    resolveRefresh('new-token')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ioMock).toHaveBeenCalledTimes(2)
  })
})

describe('wsClient 手动重连（M6 终态）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 重置内部 attempts（私有状态跨测试残留）：建连后触发 connect 事件即归零
    wsClient.connect('reset')
    fire(sockets.at(-1) as (typeof sockets)[number], 'connect')
    wsClient.disconnect()
    ioMock.mockClear()
    sockets.length = 0
    wsClient.setTokenProvider(null)
  })

  afterEach(() => {
    wsClient.disconnect()
    wsClient.setTokenProvider(null)
    vi.useRealTimers()
  })

  it('io server disconnect 后按退避重连，connect 成功即归零计数', () => {
    wsClient.connect('tok')
    expect(ioMock).toHaveBeenCalledTimes(1)

    fire(lastSocket(), 'disconnect', 'io server disconnect')
    vi.advanceTimersByTime(1_000)
    expect(ioMock).toHaveBeenCalledTimes(2)

    // 重连成功：connect 事件归零 attempts，后续退避重新从 1s 起步
    fire(lastSocket(), 'connect')
    fire(lastSocket(), 'disconnect', 'io server disconnect')
    vi.advanceTimersByTime(1_000)
    expect(ioMock).toHaveBeenCalledTimes(3)
  })

  it('M6: 连续手动重连达上限后放弃，不再排新连接（防无限循环污染审计）', () => {
    wsClient.connect('tok')
    expect(ioMock).toHaveBeenCalledTimes(1)

    // 从未连上（不触发 connect 事件归零），连续被踢 12 轮
    for (let i = 0; i < 12; i++) {
      fire(lastSocket(), 'disconnect', 'io server disconnect')
      vi.advanceTimersByTime(70_000)
    }

    // 初始 1 + 上限 10 次手动重连 = 11；之后放弃，io 不再增长
    expect(ioMock).toHaveBeenCalledTimes(11)
  })

  it('L14: provider 返回 null（已登出）时放弃重连，不拿陈旧 currentToken 回退', () => {
    wsClient.connect('stale-token')
    fire(lastSocket(), 'connect')
    expect(ioMock).toHaveBeenCalledTimes(1)

    wsClient.setTokenProvider(() => null)
    fire(lastSocket(), 'disconnect', 'io server disconnect')
    vi.advanceTimersByTime(1_000)

    // provider 返回 null 时不应再建新连接（陈旧 currentToken 不再被回退）
    expect(ioMock).toHaveBeenCalledTimes(1)
  })
})
