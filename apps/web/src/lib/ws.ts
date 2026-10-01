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
  private static readonly MAX_RECONNECT = 5
  private static readonly HEARTBEAT_INTERVAL = 10_000
  private static readonly PONG_TIMEOUT = 5_000

  connect(token: string): Socket {
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
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: WsClient.MAX_RECONNECT,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    })

    this.socket.on('connect', () => {
      this.startHeartbeat()
    })

    this.socket.on('disconnect', (reason) => {
      this.stopHeartbeat()
      // M5：服务端主动断开（jti 吊销/账号状态变更）属 io server disconnect，
      // socket.io v4 不会自动重连，必须手动恢复（token 已轮换时 currentToken 为新值）
      if (reason === 'io server disconnect' && this.currentToken) {
        const token = this.currentToken
        setTimeout(() => this.connect(token), 1000)
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
   * 仅关闭底层 socket（停心跳、解绑、置空），保留 listeners 注册表供重连后重绑。
   */
  private closeSocket(): void {
    this.stopHeartbeat()
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
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
        const token = this.currentToken
        this.closeSocket()
        if (token) {
          setTimeout(() => this.connect(token), 1000)
        }
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
