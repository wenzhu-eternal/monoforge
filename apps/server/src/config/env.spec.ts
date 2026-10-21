import { describe, expect, it } from 'vitest'
import { envSchema, isValidTrustProxyValue } from './env'

describe('TRUST_PROXY 校验（M3）', () => {
  it.each([
    'true',
    'false',
    '1',
    '2',
    'loopback',
    'linklocal',
    'uniquelocal',
    '127.0.0.1',
    '10.0.0.0/8',
    '::1',
    '2001:db8::/32',
    '1,127.0.0.1',
  ])('合法值: %s', (value) => {
    expect(isValidTrustProxyValue(value)).toBe(true)
  })

  it.each([
    'abc',
    '0',
    '-1',
    '1.2.3.999',
    '10.0.0.0/33',
    '::1/129',
    'true,abc',
    '',
  ])('非法值: %s', (value) => {
    expect(isValidTrustProxyValue(value)).toBe(false)
  })
})

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  NODE_ENV: 'test',
}

describe('存储目录交叉校验（M2）', () => {
  it('BACKUP_DIR 位于 UPLOAD_DIR 内时拒绝', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      UPLOAD_DIR: '/data/uploads',
      BACKUP_DIR: '/data/uploads/backups',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['BACKUP_DIR'] }))
    }
  })

  it('BACKUP_DIR 等于 UPLOAD_DIR 时拒绝', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      UPLOAD_DIR: '/data/shared',
      BACKUP_DIR: '/data/shared/',
    })
    expect(result.success).toBe(false)
  })

  it('相对路径按 resolve 后比较，子目录同样拒绝', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      UPLOAD_DIR: './uploads',
      BACKUP_DIR: './uploads/backups',
    })
    expect(result.success).toBe(false)
  })

  it('默认目录（uploads/backups）与独立兄弟目录放行', () => {
    expect(envSchema.safeParse(baseEnv).success).toBe(true)
    expect(
      envSchema.safeParse({
        ...baseEnv,
        UPLOAD_DIR: '/data/uploads',
        BACKUP_DIR: '/data/backups',
      }).success,
    ).toBe(true)
  })
})
