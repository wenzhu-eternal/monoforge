import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    query: { users: { findFirst: vi.fn() } },
    select: vi.fn(),
  },
}))

// isAdminUser 依赖 getEnv().ADMIN_ROLE_ID，固定为 1（L34 模式），顺带给 CORS origin 读值
vi.mock('@/config/env', () => ({
  getEnv: () => ({ ADMIN_ROLE_ID: 1, ALLOW_ORIGIN: 'http://localhost:3000' }),
}))

const { db } = await import('@/db')
const { EventsGateway } = await import('./events.gateway')

interface FakeClient {
  id: string
  connected: boolean
  handshake: { auth?: { token?: string } }
  data: Record<string, unknown>
  emit: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  join: ReturnType<typeof vi.fn>
  leave: ReturnType<typeof vi.fn>
}

function makeClient(token?: string): FakeClient {
  return {
    id: 'sock-1',
    connected: true,
    handshake: token ? { auth: { token } } : {},
    data: {},
    emit: vi.fn(),
    disconnect: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
  }
}

describe('EventsGateway 60s 重校验（L4 token 自然过期）', () => {
  let gateway: InstanceType<typeof EventsGateway>
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> }
  let redisService: {
    get: ReturnType<typeof vi.fn>
    eval: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
  }
  let client: FakeClient

  beforeEach(() => {
    vi.clearAllMocks()
    jwtService = { verifyAsync: vi.fn() }
    redisService = {
      get: vi.fn().mockResolvedValue(null),
      eval: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue(undefined),
    }
    gateway = new EventsGateway(
      jwtService as never,
      { get: vi.fn().mockReturnValue('secret') } as never,
      redisService as never,
    )
    gateway.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as never
    client = makeClient('access-token')
    // admin 直通路径（roleId=1）：loadUserPermissions 不触达 db.select
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: 1,
      username: 'admin',
      roleId: 1,
      status: true,
      deletedAt: null,
    } as never)
  })

  it('L4: 握手时有效的 token 到期后，60s 重校验断开（复现：旧实现连接无限存活）', async () => {
    vi.useFakeTimers()
    try {
      // 握手时 exp 尚有 5s（真实 verifyAsync 只在握手校验一次），60s 后自然过期
      const exp = Math.floor(Date.now() / 1000) + 5
      jwtService.verifyAsync.mockResolvedValue({
        sub: 1,
        username: 'admin',
        jti: 'jti-1',
        exp,
      })

      await gateway.handleConnection(client as never)
      expect(client.disconnect).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(60_000)

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: '登录状态已过期，连接被断开',
      })
      expect(client.disconnect).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('L4: 未过期 token 的重校验放行，连接不断', async () => {
    vi.useFakeTimers()
    try {
      const exp = Math.floor(Date.now() / 1000) + 3600
      jwtService.verifyAsync.mockResolvedValue({
        sub: 1,
        username: 'admin',
        jti: 'jti-1',
        exp,
      })

      await gateway.handleConnection(client as never)
      await vi.advanceTimersByTimeAsync(60_000)

      expect(client.disconnect).not.toHaveBeenCalled()
      // 未被踢线：jti 黑名单查了（get）但无吊销
      expect(redisService.get).toHaveBeenCalledWith('access:1:jti-1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('L4: 过期检查先于 jti 黑名单查询（短路断开）', async () => {
    vi.useFakeTimers()
    try {
      const exp = Math.floor(Date.now() / 1000) + 5
      jwtService.verifyAsync.mockResolvedValue({
        sub: 1,
        username: 'admin',
        jti: 'jti-1',
        exp,
      })

      await gateway.handleConnection(client as never)
      redisService.get.mockClear()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(client.disconnect).toHaveBeenCalled()
      expect(redisService.get).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('EventsGateway L4 断开时序 / L8 消息频控', () => {
  let gateway: InstanceType<typeof EventsGateway>
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> }
  let redisService: { get: ReturnType<typeof vi.fn>; eval: ReturnType<typeof vi.fn> }
  let client: FakeClient

  beforeEach(() => {
    vi.clearAllMocks()
    jwtService = { verifyAsync: vi.fn() }
    redisService = {
      get: vi.fn().mockResolvedValue(null),
      eval: vi.fn().mockResolvedValue(1),
    }
    gateway = new EventsGateway(
      jwtService as never,
      { get: vi.fn().mockReturnValue('secret') } as never,
      redisService as never,
    )
    gateway.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as never
    client = makeClient('access-token')
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: 1,
      username: 'admin',
      roleId: 1,
      status: true,
      deletedAt: null,
    } as never)
  })

  it('M1：握手 await 期间断开——不广播在线、不挂定时器（修复前幽灵在线 + timer 永久泄漏）', async () => {
    const presenceEmit = vi.fn()
    gateway.server = { to: vi.fn().mockReturnValue({ emit: presenceEmit }) } as never
    let release: (value: unknown) => void = () => {}
    const usersFindFirst = db.query.users.findFirst as unknown as ReturnType<typeof vi.fn>
    usersFindFirst.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    jwtService.verifyAsync.mockResolvedValue({
      sub: 1,
      username: 'admin',
      jti: 'jti-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    const connecting = gateway.handleConnection(client as never)
    // 进入 loadUserPermissions 的 await
    await new Promise((r) => setTimeout(r, 0))

    // 模拟真实断开：置 connected=false，且 handleDisconnect 先跑完（SREM + 离线广播）
    client.connected = false
    gateway.handleDisconnect(client as never)

    release({ id: 1, username: 'admin', roleId: 1, status: true, deletedAt: null })
    await connecting
    await new Promise((r) => setTimeout(r, 0))

    expect(client.data.refreshTimer).toBeUndefined()
    expect(presenceEmit).not.toHaveBeenCalledWith('presence:update', { userId: 1, online: true })
  })

  it('L4：登记 await 期间断开仍执行 SREM（userId 先于 SADD 写入 client.data）', async () => {
    let release: (value: unknown) => void = () => {}
    redisService.eval.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          release = resolve
        }),
    )
    jwtService.verifyAsync.mockResolvedValue({
      sub: 1,
      username: 'admin',
      jti: 'jti-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    const connecting = gateway.handleConnection(client as never)
    // 等握手完成、进入 SADD 的 await
    await new Promise((r) => setTimeout(r, 0))

    // 复现旧实现：此时若 userId 未落 data，disconnect 会早退、SREM 不执行
    gateway.handleDisconnect(client as never)
    expect(redisService.eval.mock.calls.some(([script]) => String(script).includes('SREM'))).toBe(
      true,
    )

    release(1)
    await connecting
    clearInterval(client.data.refreshTimer as NodeJS.Timeout)
  })

  it('L8：1s 窗口内超过 20 条消息被拒（回 error，不再回显）', () => {
    for (let i = 0; i < 20; i++) {
      expect(gateway.handlePing(client as never, i)).toEqual({ event: 'pong', data: i })
    }
    expect(gateway.handlePing(client as never, 20)).toBeUndefined()
    expect(client.emit).toHaveBeenCalledWith('error', {
      message: '消息发送过于频繁，请稍后再试',
    })
  })

  it('L8：窗口滚动后计数复位（长连接正常使用不被误伤）', () => {
    vi.useFakeTimers()
    try {
      for (let i = 0; i < 20; i++) gateway.handlePing(client as never, i)
      expect(gateway.handlePing(client as never, 20)).toBeUndefined()

      vi.advanceTimersByTime(1001)
      expect(gateway.handlePing(client as never, 21)).toEqual({ event: 'pong', data: 21 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('M1：extractAuth 窗口内断开——不登记、不广播、不挂定时器（复现：幽灵成员残留 300s）', async () => {
    const presenceEmit = vi.fn()
    gateway.server = { to: vi.fn().mockReturnValue({ emit: presenceEmit }) } as never
    let release: (value: unknown) => void = () => {}
    jwtService.verifyAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )

    const connecting = gateway.handleConnection(client as never)
    await new Promise((r) => setTimeout(r, 0))

    // 断开发生在 userId 落库之前：handleDisconnect 早退，SREM 无从执行
    client.connected = false
    gateway.handleDisconnect(client as never)
    redisService.eval.mockClear()

    release({ sub: 1, username: 'admin', jti: 'jti-1', exp: Math.floor(Date.now() / 1000) + 3600 })
    await connecting

    // 认证窗内断开 → 直接返回，SADD 不执行
    expect(redisService.eval).not.toHaveBeenCalled()
    expect(client.data.refreshTimer).toBeUndefined()
    expect(presenceEmit).not.toHaveBeenCalledWith('presence:update', { userId: 1, online: true })
  })

  it('M1：SADD 窗口内断开——登记完成后补偿 SREM（复现：SREM 早于 SADD 等于白删）', async () => {
    const presenceEmit = vi.fn()
    gateway.server = { to: vi.fn().mockReturnValue({ emit: presenceEmit }) } as never
    let release: (value: unknown) => void = () => {}
    redisService.eval.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          release = resolve
        }),
    )
    jwtService.verifyAsync.mockResolvedValue({
      sub: 1,
      username: 'admin',
      jti: 'jti-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    const connecting = gateway.handleConnection(client as never)
    await new Promise((r) => setTimeout(r, 0))

    // 断开恰好落在 SADD 的 await 中：handleDisconnect 的 SREM 先于 SADD 完成
    client.connected = false
    gateway.handleDisconnect(client as never)
    redisService.eval.mockClear()
    release(1)
    await connecting

    // SADD 完成后复检命中 → 内联补偿 SREM
    expect(redisService.eval).toHaveBeenCalledTimes(1)
    expect(String(redisService.eval.mock.calls[0]?.[0])).toContain('SREM')
    expect(client.data.refreshTimer).toBeUndefined()
    expect(presenceEmit).not.toHaveBeenCalledWith('presence:update', { userId: 1, online: true })
  })
})
