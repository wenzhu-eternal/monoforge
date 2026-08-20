import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '@/app.module'
import { SanitizeBodyPipe } from '@/common/pipes/sanitize-body.pipe'
import { XssPipe } from '@/common/pipes/xss.pipe'

/**
 * 冒烟测试：部署后全量 API 可用性验证
 *
 * 覆盖范围：63 个 API 端点（auth/users/roles/permissions/role-permissions/routes/files/
 *           audit-logs/error-logs/notifications/websocket/mail/wechat/setup/health/schedule）
 *
 * 运行前提：
 *   1. docker compose up -d postgres redis
 *   2. pnpm db:migrate
 *   3. pnpm db:seed（创建初始 admin 账号，密码 888888）
 *
 * 运行：pnpm --filter=server test:e2e
 *
 * 注意：本测试会操作真实数据库，仅限开发/测试环境运行。
 */
describe('冒烟测试（Smoke）- 全量 API', () => {
  let app: INestApplication
  let accessToken: string
  let adminUserId: number
  let createdUserId: number
  let createdRoleId: number
  let createdPermissionId: number
  let createdFileId: number
  let createdErrorLogId: number
  let createdWhitelistId: number

  const adminCredentials = {
    username: 'admin',
    password: '888888', // 与 seed.ts 一致
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api/v1')
    // 与 main.ts 保持一致的全局管道：清洗 → Zod 校验 → XSS 清洗
    app.useGlobalPipes(new SanitizeBodyPipe(), new ZodValidationPipe(), new XssPipe())
    await app.init()
  }, 30000)

  afterAll(async () => {
    if (app) await app.close()
  }, 15000)

  // ============================================================
  // 1. health 模块
  // ============================================================
  describe('health 健康检查', () => {
    it('GET /health → 200 + status=ok', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200)
      expect(res.body.data.status).toBe('ok')
      expect(res.body.data.database).toBe('ok')
      expect(res.body.data.redis).toBe('ok')
    })
  })

  // ============================================================
  // 2. setup 模块（系统初始化）
  // ============================================================
  describe('setup 系统初始化', () => {
    it('GET /setup/status → 200 + initialized=true', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/setup/status').expect(200)
      // 已 seed 过，应为 true
      expect(res.body.data.initialized).toBe(true)
    })
  })

  // ============================================================
  // 3. auth 模块
  // ============================================================
  describe('auth 认证', () => {
    it('POST /auth/login 正确密码 → 200 + accessToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(adminCredentials)
        .expect(200)

      expect(res.body.data.accessToken).toBeTruthy()
      expect(res.body.data.user).toBeTruthy()
      expect(res.body.data.user.username).toBe('admin')
      accessToken = res.body.data.accessToken
      adminUserId = res.body.data.user.id
    })

    it('POST /auth/login 错误密码 → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'wrong-password' })
        .expect(401)
    })

    it('POST /auth/login 缺字段 → 400 + Zod 错误', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: '' })
        .expect(400)
      expect(res.body.message || res.body.data).toBeTruthy()
    })

    it('GET /auth/me 无 token → 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401)
    })

    it('GET /auth/me 带 token → 200 + 用户信息', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data.username).toBe('admin')
    })

    it('POST /auth/logout → 200（不真正登出，只验证接口可用）', async () => {
      // 用一个临时登录的 token 来测 logout，避免污染主 token
      const tempLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(adminCredentials)
        .expect(200)
      const tempToken = tempLoginRes.body.data.accessToken

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tempToken}`)
        .expect(200)
      expect(res.body).toBeTruthy()
    })

    it('POST /auth/refresh 无 cookie → 401', async () => {
      // 无 refresh token cookie
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401)
    })

    it('POST /auth/send-register-code → 200/400/409/500（SMTP 视配置）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/send-register-code')
        .send({ email: 'smoke-test@example.com' })
      // 200: 发送成功；400: Zod 校验失败；409: 邮箱已注册或 60 秒内重复发送；500: SMTP 异常
      expect([200, 400, 409, 500]).toContain(res.status)
    }, 30000)

    it('POST /auth/register 缺字段 → 400/422', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username: 'sm', email: 'invalid', password: '123' })
      expect([400, 422]).toContain(res.status)
    })
  })

  // ============================================================
  // 4. users 模块
  // ============================================================
  describe('users 用户管理', () => {
    it('GET /users → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toHaveProperty('list')
      expect(res.body.data).toHaveProperty('total')
    })

    it('GET /users/stats → 200 + 统计结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/stats')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toBeTruthy()
    })

    it('POST /users 创建用户 → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          username: `smoke_user_${Date.now()}`, // UsernameSchema 禁用连字符
          email: `smoke-${Date.now()}@test.com`,
          password: 'smoke123456',
          nickname: '冒烟用户',
        })
        .expect(201)
      expect(res.body.data.id).toBeTruthy()
      createdUserId = res.body.data.id
    })

    it('GET /users/:id → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${createdUserId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data.id).toBe(createdUserId)
    })

    it('PATCH /users/:id 更新 → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${createdUserId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          email: `smoke-updated-${Date.now()}@test.com`,
          nickname: '冒烟用户-已更新',
        })
        .expect(200)
    })

    it('DELETE /users/:id 删除 → 200/204', async () => {
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

    it('DELETE /users/1 (admin) → 409（初始管理员不可删除）', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/users/${adminUserId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409)
    })

    it('GET /users 无 token → 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401)
    })
  })

  // ============================================================
  // 5. roles 模块
  // ============================================================
  describe('roles 角色管理', () => {
    it('GET /roles → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toHaveProperty('list')
      expect(res.body.data).toHaveProperty('total')
    })

    it('POST /roles 创建角色 → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: `smoke-role-${Date.now()}`, description: '冒烟测试角色' })
        .expect(201)
      expect(res.body.data.id).toBeTruthy()
      createdRoleId = res.body.data.id
    })

    it('GET /roles/:id → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/roles/${createdRoleId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data.id).toBe(createdRoleId)
    })

    it('PATCH /roles/:id 更新 → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/roles/${createdRoleId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: '冒烟测试角色-已更新' })
        .expect(200)
    })

    it('DELETE /roles/:id → 200', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/roles/${createdRoleId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
    })

    it('POST /roles 非法字段 → 400/422', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: '缺少 name 字段' })
      expect([400, 422]).toContain(res.status)
    })
  })

  // ============================================================
  // 6. permissions 模块
  // ============================================================
  describe('permissions 权限管理', () => {
    it('GET /permissions → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/permissions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toHaveProperty('list')
      expect(res.body.data).toHaveProperty('total')
    })

    it('GET /permissions/list → 200 + 数组', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/permissions/list')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('POST /permissions 创建权限 → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/permissions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          code: `smoke:perm:${Date.now()}`,
          name: '冒烟测试权限',
          description: 'e2e smoke test permission',
        })
        .expect(201)
      expect(res.body.data.id).toBeTruthy()
      createdPermissionId = res.body.data.id
    })

    it('GET /permissions/:id → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/permissions/${createdPermissionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data.id).toBe(createdPermissionId)
    })

    it('PATCH /permissions/:id 更新 → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/permissions/${createdPermissionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: '冒烟测试权限-已更新' })
        .expect(200)
    })

    it('DELETE /permissions/:id → 200', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/permissions/${createdPermissionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
    })
  })

  // ============================================================
  // 7. role-permissions 模块
  // ============================================================
  describe('role-permissions 角色权限关联', () => {
    it('GET /role-permissions → 200 + 数组', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/role-permissions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toBeTruthy()
    })

    it('GET /role-permissions/role/:roleId → 200', async () => {
      // admin 角色通常 id=1
      const res = await request(app.getHttpServer())
        .get('/api/v1/role-permissions/role/1')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toBeTruthy()
    })

    it('PUT /role-permissions/role/:roleId → 200', async () => {
      // 给 user 角色(id=2)配置空权限数组（不破坏现有配置）
      // 注意：DTO 字段名是 permissions 不是 permissionIds（见 UpdateRolePermissionsSchema）
      await request(app.getHttpServer())
        .put('/api/v1/role-permissions/role/2')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ permissions: [] })
        .expect(200)
    })
  })

  // ============================================================
  // 8. routes 模块
  // ============================================================
  describe('routes 路由元数据', () => {
    it('GET /routes → 200 + 数组', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/routes')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBeGreaterThan(0)
    })
  })

  // ============================================================
  // 9. files 模块
  // ============================================================
  describe('files 文件管理', () => {
    it('GET /files → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/files')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toHaveProperty('list')
      expect(res.body.data).toHaveProperty('total')
    })

    it('POST /files/upload 上传 PNG → 201', async () => {
      // 1x1 透明 PNG 的 base64
      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const pngBuffer = Buffer.from(pngBase64, 'base64')

      const res = await request(app.getHttpServer())
        .post('/api/v1/files/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', pngBuffer, 'smoke-test.png')
        .expect(201)

      expect(res.body.data.id).toBeTruthy()
      expect(res.body.data.originalName).toBe('smoke-test.png')
      createdFileId = res.body.data.id
    })

    it('GET /files/:id/preview → 200', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/files/${createdFileId}/preview`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
    })

    it('GET /files/:id/download → 200', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/files/${createdFileId}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
    })

    it('DELETE /files/:id → 200/204', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/files/${createdFileId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect([200, 204])
    })

    it('POST /files/upload 无文件 → 400/404', async () => {
      // service 抛 NotFoundException('文件未上传')→404；Zod 校验失败→400
      await request(app.getHttpServer())
        .post('/api/v1/files/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('dummy', 'trigger-multipart')
        .expect([400, 404])
    })
  })

  // ============================================================
  // 10. error-logs 模块
  // ============================================================
  describe('error-logs 错误日志', () => {
    it('POST /error-logs/report 上报错误 → 200/201', async () => {
      // @Public 接口，不需要 token
      const res = await request(app.getHttpServer())
        .post('/api/v1/error-logs/report')
        .send({
          source: 'backend',
          errorType: 'api_error',
          message: `smoke-error-${Date.now()}`,
          stack: 'Error: smoke test',
        })
        .expect([200, 201])
      if (res.body.data?.id) {
        createdErrorLogId = res.body.data.id
      }
    })

    it('GET /error-logs → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/error-logs')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toHaveProperty('list')
      expect(res.body.data).toHaveProperty('total')
    })

    it('GET /error-logs/stats → 200 + 统计结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/error-logs/stats')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toHaveProperty('total')
      expect(res.body.data).toHaveProperty('unresolved')
    })

    it('GET /error-logs/grouped → 200 + 数组', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/error-logs/grouped')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('GET /error-logs/whitelist → 200 + 数组', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/error-logs/whitelist')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('POST /error-logs/whitelist 新增白名单 → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/error-logs/whitelist')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          pattern: `smoke-whitelist-${Date.now()}`,
          matchType: 'message',
          description: 'smoke test',
          isActive: true,
        })
        .expect(201)
      expect(res.body.data.id).toBeTruthy()
      createdWhitelistId = res.body.data.id
    })

    it('GET /error-logs/:id → 200', async () => {
      // 先确保有一条错误日志
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/error-logs?pageSize=1')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      const firstLog = listRes.body.data.list?.[0]
      if (firstLog) {
        await request(app.getHttpServer())
          .get(`/api/v1/error-logs/${firstLog.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      }
    })

    it('POST /error-logs/:id/resolve 标记已处理 → 200', async () => {
      // 用刚上报的错误或列表第一条
      const targetId = createdErrorLogId
      if (targetId) {
        await request(app.getHttpServer())
          .post(`/api/v1/error-logs/${targetId}/resolve`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      }
    })

    it('POST /error-logs/batch-resolve 批量处理 → 200', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/error-logs/batch-resolve')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'nonexistent-smoke-error', source: 'backend' })
        .expect(200)
      expect(res.body.data).toHaveProperty('affected')
    })

    it('PATCH /error-logs/whitelist/:id 更新白名单 → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/error-logs/whitelist/${createdWhitelistId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: 'smoke updated' })
        .expect(200)
    })

    it('DELETE /error-logs/whitelist/:id 删除白名单 → 200', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/error-logs/whitelist/${createdWhitelistId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
    })

    it('DELETE /error-logs/:id 删除错误日志 → 200', async () => {
      if (createdErrorLogId) {
        await request(app.getHttpServer())
          .delete(`/api/v1/error-logs/${createdErrorLogId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      }
    })

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

  // ============================================================
  // 11. audit-logs 模块
  // ============================================================
  describe('audit-logs 审计日志', () => {
    it('GET /audit-logs → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toHaveProperty('list')
      expect(res.body.data).toHaveProperty('total')
      // 前面的操作会产生审计日志
      expect(res.body.data.total).toBeGreaterThan(0)
    })

    it('GET /audit-logs/:id → 200', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/audit-logs?pageSize=1')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      const firstLog = listRes.body.data.list?.[0]
      if (firstLog) {
        await request(app.getHttpServer())
          .get(`/api/v1/audit-logs/${firstLog.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      }
    })
  })

  // ============================================================
  // 12. notifications 模块
  // ============================================================
  describe('notifications 通知', () => {
    it('GET /notifications → 200 + 分页结构', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toBeTruthy()
    })

    it('GET /notifications/unread-count → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toBeTruthy()
    })

    it('POST /notifications/read-all → 200', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
    })
  })

  // ============================================================
  // 13. websocket 模块（HTTP 部分，WS 连接由 e2e 覆盖）
  // ============================================================
  describe('websocket WebSocket（HTTP 接口）', () => {
    it('GET /websocket/online → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/websocket/online')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toBeTruthy()
    })

    it('GET /websocket/me → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/websocket/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(res.body.data).toBeTruthy()
    })

    it('POST /websocket/notify 给自己发通知 → 200', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/websocket/notify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          userId: adminUserId,
          type: 'smoke-test',
          title: 'smoke 测试通知',
          content: 'smoke test notification',
        })
        .expect(200)
      expect(res.body.data).toBeTruthy()
    })
  })

  // ============================================================
  // 14. mail 模块
  // ============================================================
  describe('mail 邮件', () => {
    it('POST /mail/welcome → 200/400/500', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/mail/welcome')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ to: 'smoke-test@example.com', username: 'smoke-test' })
      // 已配置 SMTP：200；未配置：400；SMTP 异常：500
      expect([200, 400, 500]).toContain(res.status)
    }, 30000)

    it('POST /mail/verification-code → 200/400/500', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/mail/verification-code')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ to: 'smoke-test@example.com', name: 'smoke' })
      expect([200, 400, 500]).toContain(res.status)
    }, 30000)
  })

  // ============================================================
  // 15. wechat 模块
  // ============================================================
  describe('wechat 微信', () => {
    it('GET /wechat/qrcode → 200/400/500（视配置）', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/wechat/qrcode')
      // 未配置 WEAPP_APPID 时可能返回错误
      expect([200, 400, 500]).toContain(res.status)
    }, 15000)

    it('GET /wechat/status → 200/400/500', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/wechat/status')
      expect([200, 400, 500]).toContain(res.status)
    }, 15000)

    it('POST /wechat/login 无效 code → 400/401/503（视 appid 配置）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/wechat/login')
        .send({ code: 'invalid-smoke-code', loginType: 'qrcode' })
      // 503: 未配置 WEAPP_APPID；401: 配了无效 appid 调微信 API 失败；400: Zod 校验失败
      expect([400, 401, 500, 503]).toContain(res.status)
    }, 15000)
  })

  // ============================================================
  // 16. schedule 模块
  // ============================================================
  describe('schedule 定时任务', () => {
    it('POST /schedule/backup → 200/400/500（视环境）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/schedule/backup')
        .set('Authorization', `Bearer ${accessToken}`)
      // 备份可能因 BACKUP_CMD 未配置而失败
      expect([200, 400, 500]).toContain(res.status)
    }, 30000)
  })

  // ============================================================
  // 17. 权限保护（越权验证）
  // ============================================================
  describe('权限保护', () => {
    it('GET /users 无 token → 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401)
    })

    it('GET /permissions 无 token → 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/permissions').expect(401)
    })
  })
})
