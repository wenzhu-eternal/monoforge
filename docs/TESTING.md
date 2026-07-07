# 测试规范

## 测试分层

| 层级 | 目的 | 速度 | 依赖 | 命令 |
|---|---|---|---|---|
| 单元测试（unit） | 验证 service/controller 单一函数逻辑 | 快（ms） | Mock DB/Redis | `pnpm test` |
| E2E 冒烟测试（smoke） | 验证核心接口端到端可用 | 中（s） | 真实 DB | `pnpm --filter=server test:e2e` |
| 安全/规范检测 | 代码静态扫描 | 快（ms） | 无 | `pnpm security` |

## 单元测试

### 覆盖范围

- **Service**：所有 `*.service.ts` 必须配套 `*.service.spec.ts`
- **Controller**：所有 `*.controller.ts` 必须配套 `*.controller.spec.ts`
- **Hook**：所有 `use-*.ts` 必须配套 `use-*.spec.ts`

### 命名

- 文件：`{name}.spec.ts`（与被测文件同目录）
- 测试套件：`describe('{ClassName}', () => {})`
- 用例：`it('应该 {行为} 当 {条件}', () => {})` 中文描述

### Mock 原则

- DB 查询：mock `db.query.*` / `db.select()` 返回值
- Redis：mock `ioredis` 完整实例
- 外部 API（邮件/微信）：mock 整个 service
- 禁止 mock 被测对象本身

### 覆盖率要求

- **语句覆盖**：>= 80%
- **分支覆盖**：>= 70%
- **核心 service**（auth/users/roles/permissions/error-logs）：>= 90%

```bash
pnpm --filter=server test:cov
pnpm --filter=web test:cov
```

### Bug 修复流程

1. 先写复现测试（red）
2. 修复代码（green）
3. 验证测试通过
4. 补充边缘场景测试

## E2E 冒烟测试

### 定位

不是全量 e2e，而是**部署后快速验证核心功能可用**的冒烟用例。覆盖：

1. **健康检查**：`/api/v1/health` 返回 200
2. **认证**：login 成功返回 access_token，错误密码 401
3. **CRUD**：users/roles/permissions 的 list/create/update/delete 全流程
4. **权限**：无权限访问返回 403
5. **错误日志**：500 错误能被记录到数据库
6. **文件上传**：上传/下载/删除全流程
7. **邮件**：发送验证码邮件（mock 传输器）

### 运行

```bash
# 启动测试数据库 + Redis
docker compose up -d postgres redis

# 执行迁移
pnpm db:migrate

# 运行 e2e 冒烟
pnpm --filter=server test:e2e
```

### 编写规范

- 文件位置：`apps/server/test/e2e/*.e2e-spec.ts`
- 用 `supertest` 发真实 HTTP 请求
- 用真实 DB（非 mock），每个测试前 truncate 表
- 用 `Test.createTestingModule` 组装完整模块
- 测试间相互独立，不依赖执行顺序

```ts
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '@/app.module'

describe('冒烟测试', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => await app.close())

  it('GET /health → 200', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(res => {
        if (res.body.status !== 'ok') throw new Error('status 不为 ok')
      })
  })
})
```

## 安全与规范检测

### 自动化脚本

```bash
pnpm security   # 等价于 bash scripts/security-check.sh
```

脚本会执行：

1. **TypeScript 类型检查**：`pnpm -r exec tsc --noEmit`
2. **Biome lint**：`pnpm lint`
3. **软删除过滤审计**：扫描所有 service 是否有 `findFirst/findMany/select` 缺 `notDeleted`
4. **前端 catch 块审计**：扫描所有 `.tsx` 是否有 `catch {}` 不读 error
5. **环境变量完整性**：对比 `.env` 与 `.env.example` 关键变量
6. **依赖安全扫描**：`pnpm audit --prod`
7. **文档链接有效性**：检查所有 markdown 内部链接指向真实文件

## 测试数据管理

### 种子数据

- 生产种子：`apps/server/src/db/seed.ts`（admin 账号 + 初始权限）
- 测试种子：e2e 测试内部自建（不依赖生产 seed）

### 数据隔离

- 单测：全部 mock，不碰真实 DB
- E2E：用真实 DB，每个测试 `beforeEach` truncate
- 生产：禁止 `db:seed`（除非首次部署）

## CI/CD 集成

```yaml
# .github/workflows/ci.yml（示例）
jobs:
  test:
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm security          # 安全+规范检测
      - run: pnpm test              # 单元测试
      - run: pnpm --filter=server test:e2e  # e2e 冒烟
```
