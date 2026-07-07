import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '@/app.module'

/**
 * 冒烟测试：部署后核心接口可用性验证
 *
 * 运行前提：
 *   1. docker compose up -d postgres redis
 *   2. pnpm db:migrate
 *   3. pnpm db:seed（创建初始 admin 账号）
 *
 * 运行：pnpm --filter=server test:e2e
 *
 * 注意：本测试会操作真实数据库，仅限开发/测试环境运行。
 */
describe('冒烟测试（Smoke）', () => {
  let app: INestApplication
  let accessToken: string
  let createdUserId: number
  let createdRoleId: number

  // 测试账号（来自 seed 或此处注册）
  const adminCredentials = {
    username: 'admin',
    password: 'admin123',
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    await app.init()
  }, 30000)

  afterAll(async () => {
    if (app) await app.close()
  }, 15000)

  describe('健康检查', () => {
    it('GET /api/v1/health → 200 + status=ok', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200)
      expect(res.body.status).toBe('ok')
      expect(res.body.database).toBe('ok')
      expect(res.body.redis).toBe('ok')
    })
  })

  describe('认证', () => {
    it('POST /api/v1/auth/login 正确密码 → 200 + accessToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(adminCredentials)
        .expect(200)

      expect(res.body.accessToken).toBeTruthy()
      expect(res.body.user).toBeTruthy()
      expect(res.body.user.username).toBe('admin')
      accessToken = res.body.accessToken
    })

    it('POST /api/v1/auth/login 错误密码 → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'wrong-password' })
        .expect(401)
    })

    it('GET /api/v1/auth/me 无 token → 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401)
    })

    it('GET /api/v1/auth/me 带 token → 200 + 用户信息', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(res.body.username).toBe('admin')
    })
  })

  describe('角色管理 CRUD', () => {
    it('GET /api/v1/roles → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(res.body).toHaveProperty('list')
      expect(res.body).toHaveProperty('total')
      expect(Number.isInteger(res.body.total)).toBe(true)
    })

    it('POST /api/v1/roles 创建角色 → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: `smoke-role-${Date.now()}`, description: '冒烟测试角色' })
        .expect(201)

      expect(res.body.id).toBeTruthy()
      createdRoleId = res.body.id
    })

    it('PATCH /api/v1/roles/:id 更新角色 → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/roles/${createdRoleId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: '冒烟测试角色-已更新' })
        .expect(200)
    })
  })

  describe('权限管理 CRUD', () => {
    it('GET /api/v1/permissions → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/permissions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(res.body).toHaveProperty('list')
      expect(res.body).toHaveProperty('total')
    })

    it('POST /api/v1/permissions 创建权限 → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/permissions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          code: `smoke:perm:${Date.now()}`,
          name: '冒烟测试权限',
          description: 'e2e smoke test permission',
        })
        .expect(201)

      expect(res.body.id).toBeTruthy()
    })
  })

  describe('用户管理 CRUD', () => {
    it('GET /api/v1/users → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(res.body).toHaveProperty('list')
      expect(res.body).toHaveProperty('total')
    })

    it('POST /api/v1/users 创建用户 → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          username: `smoke-user-${Date.now()}`,
          email: `smoke-${Date.now()}@test.com`,
          password: 'smoke123456',
          nickname: '冒烟用户',
          roleId: createdRoleId,
        })
        .expect(201)

      expect(res.body.id).toBeTruthy()
      createdUserId = res.body.id
    })

    it('DELETE /api/v1/users/:id 删除用户 → 200/204', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/users/${createdUserId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect([200, 204])

      // 软删后再次删除应 404 或 409
      await request(app.getHttpServer())
        .delete(`/api/v1/users/${createdUserId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect([404, 409])
    })

    it('DELETE /api/v1/users/1 (admin) → 409（初始管理员不可删除）', async () => {
      // admin 用户 id 通常为 1，若 seed 不同此断言可能失败
      const adminUserRes = await request(app.getHttpServer())
        .get('/api/v1/users?username=admin')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      const adminUser = adminUserRes.body.list?.find(
        (u: { username: string }) => u.username === 'admin',
      )
      if (adminUser) {
        await request(app.getHttpServer())
          .delete(`/api/v1/users/${adminUser.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(409)
      }
    })
  })

  describe('错误日志', () => {
    it('GET /api/v1/error-logs → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/error-logs')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(res.body).toHaveProperty('list')
      expect(res.body).toHaveProperty('total')
    })

    it('GET /api/v1/error-logs/stats → 200 + 统计结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/error-logs/stats')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(res.body).toHaveProperty('total')
      expect(res.body).toHaveProperty('unresolved')
    })
  })

  describe('Zod 校验', () => {
    it('POST /api/v1/auth/login 缺字段 → 400 + 错误信息', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: '' })
        .expect(400)

      // HttpExceptionFilter 兼容 nestjs-zod v5 的 issues 字段
      expect(res.body.message).toBeTruthy()
    })

    it('POST /api/v1/roles 非法字段 → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: '', description: '' })
        .expect(400)
    })
  })

  describe('权限保护', () => {
    it('GET /api/v1/users 无 token → 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401)
    })
  })

  describe('限流', () => {
    it('error-logs 只读接口 @SkipThrottle 不被限流', async () => {
      // 连续请求 5 次不应被 429 拦截
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .get('/api/v1/error-logs')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      }
    })
  })
})
