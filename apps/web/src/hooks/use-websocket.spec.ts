import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 被 hoist，需用 vi.hoisted 创建 mock 对象
const { wsMock, apiMock, refreshMock } = vi.hoisted(() => ({
  wsMock: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setTokenProvider: vi.fn(),
    isConnected: vi.fn(() => true),
  },
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
  },
  refreshMock: vi.fn(),
}))

vi.mock('@/lib/ws', () => ({ wsClient: wsMock }))
vi.mock('@/lib/api', () => ({ api: apiMock, refreshAccessToken: refreshMock }))

import { useAuthStore } from '@/store/auth-store'
import { renderHookWithQuery } from '@/test/utils'
import { useWebSocket } from './use-websocket'

type RefreshHandler = () => Promise<string | null>

function getRefreshHandler(): RefreshHandler {
  return wsMock.setTokenProvider.mock.calls.at(-1)?.[1] as RefreshHandler
}

describe('useWebSocket（M6/J2）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
  })

  it('M6: refresh 被 401 拒绝 → 终态清态（切断被踢重连死循环）', async () => {
    useAuthStore.setState({ user: { id: 1 } as never, token: 'tok', isAuthenticated: true })
    renderHookWithQuery(() => useWebSocket())

    refreshMock.mockRejectedValue({ response: { status: 401 } })
    const result = await getRefreshHandler()()

    expect(result).toBeNull()
    // clearUserScopedState 生效：认证态清空，token 为空后 scheduleReconnect 不再建连
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('M6: 网络错误刷新 → 不误登出，返回 null 交给退避重连', async () => {
    useAuthStore.setState({ user: { id: 1 } as never, token: 'tok', isAuthenticated: true })
    renderHookWithQuery(() => useWebSocket())

    refreshMock.mockRejectedValue(new Error('network down'))
    const result = await getRefreshHandler()()

    expect(result).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('M6: 429 限流刷新 → 不误登出', async () => {
    useAuthStore.setState({ user: { id: 1 } as never, token: 'tok', isAuthenticated: true })
    renderHookWithQuery(() => useWebSocket())

    refreshMock.mockRejectedValue({ response: { status: 429 } })
    const result = await getRefreshHandler()()

    expect(result).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('J2: token 轮换不触发 socket 重建，provider 实时取新值', () => {
    useAuthStore.setState({ user: { id: 1 } as never, token: 'tok-1', isAuthenticated: true })
    renderHookWithQuery(() => useWebSocket())

    expect(wsMock.connect).toHaveBeenCalledTimes(1)
    expect(wsMock.connect).toHaveBeenCalledWith('tok-1')

    const provider = wsMock.setTokenProvider.mock.calls.at(-1)?.[0] as () => string | null
    useAuthStore.getState().setToken('tok-2')

    // 轮换不再整体重建（presence 掉线/上线抖动根源）
    expect(wsMock.connect).toHaveBeenCalledTimes(1)
    // auth 回调/重连时点取到的是新 token
    expect(provider()).toBe('tok-2')
  })

  it('登出 → 断开连接', () => {
    useAuthStore.setState({ user: { id: 1 } as never, token: 'tok', isAuthenticated: true })
    const { unmount } = renderHookWithQuery(() => useWebSocket())

    unmount()

    expect(wsMock.disconnect).toHaveBeenCalled()
  })
})
