import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockScan = vi.fn()
const mockDel = vi.fn()

vi.mock('ioredis', () => ({
  // biome-ignore lint/complexity/useArrowFunction: mock 构造器必须用 function 以支持 new
  default: vi.fn(function () {
    return {
      on: vi.fn(),
      quit: vi.fn(),
      scan: (...args: unknown[]) => mockScan(...(args as Parameters<typeof mockScan>)),
      del: (...args: unknown[]) => mockDel(...(args as Parameters<typeof mockDel>)),
    }
  }),
}))

const { RedisService } = await import('./redis.service')

function makeConfigService() {
  return { get: vi.fn().mockReturnValue('redis://localhost:6379') } as never
}

describe('RedisService per-user 精确段过滤（H1）', () => {
  beforeEach(() => {
    mockScan.mockReset()
    mockDel.mockReset().mockResolvedValue(1)
  })

  it('deleteByPattern refresh:1:* 不误删 refresh:10:/refresh:100: 的 key', async () => {
    mockScan.mockResolvedValueOnce([
      '0',
      ['refresh:1:aaa', 'refresh:10:bbb', 'refresh:100:ccc', 'refresh:1:ddd'],
    ])
    const service = new RedisService(makeConfigService())

    const deleted = await service.deleteByPattern('refresh:1:*')

    expect(mockDel).toHaveBeenCalledTimes(1)
    expect(mockDel).toHaveBeenCalledWith('refresh:1:aaa', 'refresh:1:ddd')
    expect(deleted).toBe(2)
  })

  it('scanKeys access:active:1:* 只返回精确段 key，jti 截取不错位', async () => {
    mockScan.mockResolvedValueOnce([
      '0',
      ['access:active:1:jti-1', 'access:active:10:jti-x', 'access:active:1:jti-2'],
    ])
    const service = new RedisService(makeConfigService())

    const keys = await service.scanKeys('access:active:1:*')

    expect(keys).toEqual(['access:active:1:jti-1', 'access:active:1:jti-2'])
  })

  it('非 per-user 模式（如 perm:role:*）保持原 glob 语义不过滤', async () => {
    mockScan.mockResolvedValueOnce(['0', ['perm:role:1', 'perm:role:10']])
    const service = new RedisService(makeConfigService())

    const deleted = await service.deleteByPattern('perm:role:*')

    expect(mockDel).toHaveBeenCalledWith('perm:role:1', 'perm:role:10')
    expect(deleted).toBe(2)
  })
})
