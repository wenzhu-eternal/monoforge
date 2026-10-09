import { io, type Socket } from 'socket.io-client'
import { env } from './env'

/**
 * WebSocket 单例客户端
 * - 鉴权: auth.token = <accessToken>（后端网关解析 JWT）
 * - 心跳: 10s 一次 ping，pong 超时主动重连
 * - 断线重连: 指数退避，最多 5 次
 */
class WsClient {
  private socket: Socket | null = null
  private currentToken: string | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  // M7/M8：重连定时器句柄（断开 1s 重连 + 耗尽后 60s 兜底）——closeSocket 统一清理，
  // 卸载/登出后不再幽灵重连
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // M9：重连时实时取 token 的提供者——connect 捕获的 token 会过期/被吊销，
  // 陈旧 token 反复握手被拒即死循环；须在重连触发时点取 store 最新值
  private tokenProvider: (() => string | null) | null = null
  // M9：鉴权踢线后的刷新器——store 里的 token 与被踢原因同源（过期/吊销），
  // 只重连不换信物仍是死循环，须先真正轮换一次 access token
  private refreshHandler: (() => Promise<string | null>) | null = null
  // M9：connect_error 刷新冷却（socket.io 每次内部重试都回调，防 refresh 连发）
  private lastRefreshAt = 0
  // M9：手动重连路径退避计数（原固定 1s 间隔无限踢-连，服务端持续拒时风暴）
  private reconnectAttempts = 0
  private static readonly MAX_RECONNECT = 5
  private static readonly HEARTBEAT_INTERVAL = 10_000
  private static readonly PONG_TIMEOUT = 5_000
  private static readonly RECONNECT_DELAY_CAP = 60_000
  private static readonly REFRESH_COOLDOWN = 10_000

  /**
   * 注入实时 token 提供者与鉴权踢线刷新器。
   * provider 在重连触发时调用，返回 null 放弃重连；refreshHandler 返回最新 token 或 null
   */
  setTokenProvider(
    provider: (() => string | null) | null,
    refreshHandler?: (() => Promise<string | null>) | null,
  ): void {
    this.tokenProvider = provider
    this.refreshHandler = refreshHandler ?? null
  }

  connect(token: string): Socket {
    // L23：入口先清待触发的重连定时器——否则旧定时器带旧 token 迟到触发，
    // 会 closeSocket 掐死本次刚建好的新连接（token 轮换窗口必现）
    this.clearReconnectTimer()
    // 同 token 且已连接：直接复用；token 轮换后重挂载则走下方 closeSocket 重建
    if (this.socket?.connected && this.currentToken === token) {
      return this.socket
    }
    // M14：握手窗口/残留实例先关闭再建新连接（原直接覆盖引用，旧 socket 泄漏成服务端幽灵会话；
    // token 轮换恰逢握手时新旧双连接、在线人数重复）。只关 socket 不清 listeners，
    // 建新连接后重绑（disconnect 的 clear 仅留给登出/卸载路径，否则订阅永久丢失）。
    if (this.socket) {
      this.closeSocket()
    }

    this.currentToken = token

    // 未配置 API 地址时回退到当前页面 origin（同源部署场景）
    const baseURL = env.VITE_API_BASE_URL || window.location.origin

    this.socket = io(baseURL, {
      path: '/socket.io',
      // M9：auth 用回调——socket.io 内部每次重试都实时向 provider 取最新 token，
      // 静态对象会把 connect 时捕获的死信物一路用到底（重连风暴根源之一）
      auth: (cb) => cb({ token: this.tokenProvider?.() ?? token }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: WsClient.MAX_RECONNECT,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    })

    this.socket.on('connect', () => {
      this.reconnectAttempts = 0
      this.startHeartbeat()
    })

    this.socket.on('disconnect', (reason) => {
      this.stopHeartbeat()
      // M5：服务端主动断开（jti 吊销/账号状态变更）属 io server disconnect，
      // socket.io v4 不会自动重连，必须手动恢复
      // M9：先换新 token 再排退避重连——store 里的 token 与被踢同源，只重连即死循环
      if (reason === 'io server disconnect') {
        if (this.refreshHandler) {
          void this.refreshHandler()
            .catch(() => null)
            .finally(() => this.scheduleReconnect(1000))
        } else {
          this.scheduleReconnect(1000)
        }
      }
    })

    // M9：握手鉴权类失败先换 token——auth 回调让 socket.io 下一次内部重试即用新值
    this.socket.on('connect_error', (err: Error) => {
      if (
        this.refreshHandler &&
        /token|jwt|auth|unauthor|forbidden|401/i.test(err.message) &&
        Date.now() - this.lastRefreshAt > WsClient.REFRESH_COOLDOWN
      ) {
        this.lastRefreshAt = Date.now()
        void this.refreshHandler().catch(() => null)
      }
    })

    this.socket.on('pong', () => {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer)
        this.pongTimer = null
      }
    })

    this.socket.io.on('reconnect_attempt', (attempt) => {
      console.warn(`[WS] 第 ${attempt} 次重连中...`)
    })

    this.socket.io.on('reconnect_failed', () => {
      console.warn('[WS] 重连失败，已达最大重试次数')
      this.stopHeartbeat()
      // M8：5 次耗尽后 60s 兜底重连（纳入清理，登出/卸载不再执行）；M9：token 触发时点解析
      this.scheduleReconnect(60_000)
    })

    // 重绑历史订阅到新 socket（connect 内 closeSocket 不清 listeners，全靠这里恢复）
    for (const [event, handlers] of this.listeners) {
      for (const handler of handlers) {
        this.socket.on(event, handler as (...args: unknown[]) => void)
      }
    }

    return this.socket
  }

  /**
   * 仅关闭底层 socket（停心跳、清重连定时、解绑、置空），保留 listeners 注册表供重连后重绑。
   */
  private closeSocket(): void {
    this.stopHeartbeat()
    this.clearReconnectTimer()
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * M9：手动重连统一入口——指数退避（base 起步、60s 封顶），触发时点实时解析 token
   * （闭包捕获的旧 token 被网关反复拒绝即死循环），句柄纳入 reconnectTimer 统一清理
   */
  private scheduleReconnect(baseDelayMs: number): void {
    this.clearReconnectTimer()
    const delay = Math.min(baseDelayMs * 2 ** this.reconnectAttempts, WsClient.RECONNECT_DELAY_CAP)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      const token = this.tokenProvider?.() ?? this.currentToken
      if (token) {
        this.connect(token)
      }
    }, delay)
  }

  disconnect(): void {
    this.closeSocket()
    this.listeners.clear()
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    let handlers = this.listeners.get(event)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(event, handlers)
    }
    // 防止同一 handler 重复注册
    if (handlers.has(handler)) return
    handlers.add(handler)
    this.socket?.on(event, handler as (...args: unknown[]) => void)
  }

  off(event: string, handler?: (...args: unknown[]) => void): void {
    if (handler) {
      this.listeners.get(event)?.delete(handler)
      this.socket?.off(event, handler as (...args: unknown[]) => void)
    } else {
      this.listeners.delete(event)
      this.socket?.off(event)
    }
  }

  emit(event: string, data: unknown): void {
    this.socket?.emit(event, data)
  }

  isConnected(): boolean {
    return !!this.socket?.connected
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.socket?.emit('ping', { t: Date.now() })
      // M5：socket.io v4 手动 disconnect() 属 io client disconnect，不会自动重连——
      // 必须关闭后主动重建（closeSocket 保留 listeners，connect 会重绑）
      this.pongTimer = setTimeout(() => {
        console.warn('[WS] pong 超时，主动断开后重连')
        // M9：closeSocket（清旧定时器）后走统一退避重连，token 触发时点实时解析
        this.closeSocket()
        this.scheduleReconnect(1000)
      }, WsClient.PONG_TIMEOUT)
    }, WsClient.HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }
}

export const wsClient = new WsClient()
