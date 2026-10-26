import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectProductionWarnings, envSchema, isValidTrustProxyValue } from './env'

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

  it('反向布局（UPLOAD_DIR 位于 BACKUP_DIR 内）放行', () => {
    expect(
      envSchema.safeParse({
        ...baseEnv,
        UPLOAD_DIR: '/data/backups/uploads',
        BACKUP_DIR: '/data/backups',
      }).success,
    ).toBe(true)
  })

  it('L8：BACKUP_DIR 等于回收站目录（UPLOAD_DIR 同前缀 -trash）时拒绝', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      UPLOAD_DIR: '/data/uploads',
      BACKUP_DIR: '/data/uploads-trash',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['BACKUP_DIR'] }))
    }
  })

  it('L8：BACKUP_DIR 位于回收站目录内时拒绝（满 30 天会被静默 unlink）', () => {
    expect(
      envSchema.safeParse({
        ...baseEnv,
        UPLOAD_DIR: '/data/uploads',
        BACKUP_DIR: '/data/uploads-trash/db',
      }).success,
    ).toBe(false)
  })

  it('L8：独立兄弟目录仍放行（不误伤正常布局）', () => {
    expect(
      envSchema.safeParse({
        ...baseEnv,
        UPLOAD_DIR: '/data/uploads',
        BACKUP_DIR: '/data/backups',
      }).success,
    ).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('symlink 指向 UPLOAD_DIR 时同样拒绝', () => {
    const root = mkdtempSync(join(tmpdir(), 'mf-env-'))
    try {
      const uploads = join(root, 'uploads')
      mkdirSync(uploads, { recursive: true })
      const link = join(root, 'backups-link')
      symlinkSync(uploads, link)
      // link/backups 尚不存在，靠祖先链解析 symlink 后仍应命中交叉校验
      const result = envSchema.safeParse({
        ...baseEnv,
        UPLOAD_DIR: uploads,
        BACKUP_DIR: join(link, 'backups'),
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({ path: ['BACKUP_DIR'] }),
        )
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('UPLOAD_DIR 经 symlink 位于 BACKUP_DIR 内时放行', () => {
    const root = mkdtempSync(join(tmpdir(), 'mf-env-'))
    try {
      const backups = join(root, 'backups')
      const uploads = join(backups, 'uploads')
      mkdirSync(uploads, { recursive: true })
      const link = join(root, 'uploads-link')
      symlinkSync(uploads, link)
      // 反向布局（UPLOAD_DIR ⊆ BACKUP_DIR）解析后仍应放行
      const result = envSchema.safeParse({
        ...baseEnv,
        UPLOAD_DIR: link,
        BACKUP_DIR: backups,
      })
      expect(result.success).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('角色 ID 互斥校验（M1）', () => {
  it('ADMIN_ROLE_ID 与 DEFAULT_USER_ROLE_ID 同值时拒绝', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      ADMIN_ROLE_ID: '3',
      DEFAULT_USER_ROLE_ID: '3',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['DEFAULT_USER_ROLE_ID'] }),
      )
    }
  })

  it('默认 1/2 与显式不同值放行', () => {
    expect(envSchema.safeParse(baseEnv).success).toBe(true)
    expect(
      envSchema.safeParse({ ...baseEnv, ADMIN_ROLE_ID: '1', DEFAULT_USER_ROLE_ID: '3' }).success,
    ).toBe(true)
  })
})

const prodEnv = {
  ...baseEnv,
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  ALLOW_ORIGIN: 'https://app.example.com',
}

describe('env 上线防线（L24）', () => {
  it('DB_POOL_MAX 默认 10，合法值转型，0/非法值拒绝', () => {
    expect(envSchema.parse(baseEnv).DB_POOL_MAX).toBe(10)
    expect(envSchema.parse({ ...baseEnv, DB_POOL_MAX: '25' }).DB_POOL_MAX).toBe(25)
    expect(envSchema.safeParse({ ...baseEnv, DB_POOL_MAX: '0' }).success).toBe(false)
    expect(envSchema.safeParse({ ...baseEnv, DB_POOL_MAX: 'abc' }).success).toBe(false)
    expect(envSchema.safeParse({ ...baseEnv, DB_POOL_MAX: '1.5' }).success).toBe(false)
  })

  it('UPLOAD_DIR/BACKUP_DIR 空串归一为 undefined', () => {
    const parsed = envSchema.parse({ ...baseEnv, UPLOAD_DIR: '', BACKUP_DIR: '' })
    expect(parsed.UPLOAD_DIR).toBeUndefined()
    expect(parsed.BACKUP_DIR).toBeUndefined()
  })

  it('BACKUP_CMD 空串归一、必须含占位符且禁止命令拼接', () => {
    expect(envSchema.parse({ ...baseEnv, BACKUP_CMD: '' }).BACKUP_CMD).toBeUndefined()
    expect(
      envSchema.parse({
        ...baseEnv,
        BACKUP_CMD: 'docker exec mf-postgres pg_dump -U u -d d > {filepath}',
      }).BACKUP_CMD,
    ).toContain('{filepath}')
    expect(envSchema.safeParse({ ...baseEnv, BACKUP_CMD: 'pg_dump -d d' }).success).toBe(false)
    for (const unsafe of [
      'pg_dump {filepath}; rm -rf /',
      'pg_dump {filepath} && rm -rf /',
      'pg_dump {filepath} | gzip',
      'pg_dump {filepath}\nrm -rf /',
      'pg_dump $(id) {filepath}',
      'pg_dump `id` {filepath}',
    ]) {
      expect(envSchema.safeParse({ ...baseEnv, BACKUP_CMD: unsafe }).success).toBe(false)
    }
  })

  it('生产未配 ALLOW_ORIGIN 拒绝，配置后放行', () => {
    const missing = envSchema.safeParse({ ...prodEnv, ALLOW_ORIGIN: undefined })
    expect(missing.success).toBe(false)
    if (!missing.success) {
      expect(missing.error.issues).toContainEqual(
        expect.objectContaining({ path: ['ALLOW_ORIGIN'] }),
      )
    }
    expect(envSchema.safeParse(prodEnv).success).toBe(true)
  })

  it('生产未启用 COOKIE_SECURE 拒绝，显式允诺不安全 cookie 后放行', () => {
    const insecure = envSchema.safeParse({ ...prodEnv, COOKIE_SECURE: 'false' })
    expect(insecure.success).toBe(false)
    if (!insecure.success) {
      expect(insecure.error.issues).toContainEqual(
        expect.objectContaining({ path: ['COOKIE_SECURE'] }),
      )
    }
    expect(
      envSchema.safeParse({
        ...prodEnv,
        COOKIE_SECURE: 'false',
        ALLOW_INSECURE_COOKIE: 'true',
      }).success,
    ).toBe(true)
  })

  it('ALLOW_THROTTLE_BYPASS 仅显式 true 才开启', () => {
    expect(envSchema.parse(baseEnv).ALLOW_THROTTLE_BYPASS).toBe(false)
    expect(
      envSchema.parse({ ...baseEnv, ALLOW_THROTTLE_BYPASS: 'true' }).ALLOW_THROTTLE_BYPASS,
    ).toBe(true)
    expect(
      envSchema.parse({ ...baseEnv, ALLOW_THROTTLE_BYPASS: 'false' }).ALLOW_THROTTLE_BYPASS,
    ).toBe(false)
  })

  it('JWT 密钥拒绝过短、占位符与双密钥相同', () => {
    expect(envSchema.safeParse({ ...baseEnv, JWT_SECRET: 'short' }).success).toBe(false)
    expect(envSchema.safeParse({ ...baseEnv, JWT_SECRET: 'a'.repeat(31) }).success).toBe(false)
    expect(
      envSchema.safeParse({
        ...baseEnv,
        JWT_SECRET: 'REPLACE_ME_WITH_RANDOM_SECRET_AT_LEAST_32_CHARS',
      }).success,
    ).toBe(false)
    const same = envSchema.safeParse({
      ...baseEnv,
      JWT_REFRESH_SECRET: baseEnv.JWT_SECRET,
    })
    expect(same.success).toBe(false)
    if (!same.success) {
      expect(same.error.issues).toContainEqual(
        expect.objectContaining({ path: ['JWT_REFRESH_SECRET'] }),
      )
    }
  })

  it('DATABASE_URL/REDIS_URL 协议错误拒绝', () => {
    expect(
      envSchema.safeParse({ ...baseEnv, DATABASE_URL: 'mysql://user:pass@localhost/db' }).success,
    ).toBe(false)
    expect(envSchema.safeParse({ ...baseEnv, REDIS_URL: 'http://localhost:6379' }).success).toBe(
      false,
    )
  })
})

describe('生产启动告警（L16）', () => {
  it('生产开启限流旁路时输出告警', () => {
    const warnings = collectProductionWarnings({
      NODE_ENV: 'production',
      TRUST_PROXY: 1,
      ALLOW_THROTTLE_BYPASS: true,
      ALLOW_INSECURE_COOKIE: false,
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('ALLOW_THROTTLE_BYPASS')
    expect(warnings[0]).toContain('全站限流已旁路')
  })

  it('L9：生产开启不安全 cookie 逃生舱时输出告警', () => {
    const warnings = collectProductionWarnings({
      NODE_ENV: 'production',
      TRUST_PROXY: 1,
      ALLOW_THROTTLE_BYPASS: false,
      ALLOW_INSECURE_COOKIE: true,
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('ALLOW_INSECURE_COOKIE')
    expect(warnings[0]).toContain('明文传输')
  })

  it('生产 TRUST_PROXY=false/true 沿用原有双告警', () => {
    const none = collectProductionWarnings({
      NODE_ENV: 'production',
      TRUST_PROXY: false,
      ALLOW_THROTTLE_BYPASS: false,
      ALLOW_INSECURE_COOKIE: false,
    })
    expect(none).toHaveLength(1)
    expect(none[0]).toContain('未信任任何代理')

    const all = collectProductionWarnings({
      NODE_ENV: 'production',
      TRUST_PROXY: true,
      ALLOW_THROTTLE_BYPASS: false,
      ALLOW_INSECURE_COOKIE: false,
    })
    expect(all).toHaveLength(1)
    expect(all[0]).toContain('已信任全部代理')
  })

  it('非生产环境不输出告警', () => {
    expect(
      collectProductionWarnings({
        NODE_ENV: 'test',
        TRUST_PROXY: false,
        ALLOW_THROTTLE_BYPASS: true,
        ALLOW_INSECURE_COOKIE: true,
      }),
    ).toEqual([])
  })
})
