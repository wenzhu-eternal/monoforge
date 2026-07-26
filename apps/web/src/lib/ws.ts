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
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  private static readonly MAX_RECONNECT = 5
  private static readonly HEARTBEAT_INTERVAL = 10_000
  private static readonly PONG_TIMEOUT = 5_000

  connect(token: string): Socket {
    if (this.socket?.connected) {
      return this.socket
    }

    // 同源时 baseURL 为空，socket.io 走相对路径
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

    this.socket.on('disconnect', () => {
      this.stopHeartbeat()
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

    return this.socket
  }

  disconnect(): void {
    this.stopHeartbeat()
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
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
      // 5s 内没收到 pong，主动断开触发重连
      this.pongTimer = setTimeout(() => {
        console.warn('[WS] pong 超时，主动断开重连')
        this.socket?.disconnect()
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
