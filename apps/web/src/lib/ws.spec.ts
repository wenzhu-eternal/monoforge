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
})
