# 测试规范

## 测试分层

| 层级 | 目的 | 速度 | 依赖 | 命令 |
|---|---|---|---|---|
| 单元测试（unit） | 验证 service/controller 单一函数逻辑 | 快（ms） | Mock DB/Redis | `pnpm test` |
| E2E 冒烟测试（smoke） | 验证后端**全量 16 模块 63 API 端点**端到端可用 | 中（s） | 真实 DB | `pnpm --filter=server test:e2e` |
| 全链路 e2e（Playwright） | 验证前端 UI + 后端 API 全链路（含角色绑定/权限守卫/WebSocket） | 慢（s） | 真实 DB + 浏览器 | `pnpm test:e2e` |
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

**全量 API 冒烟**：覆盖后端 16 个模块的 63 个 API 端点，验证端到端可用。覆盖：

1. **健康检查**：`/api/v1/health` 返回 200
2. **认证**：login 成功返回 access_token，错误密码 401；`/auth/me` 返回当前用户；refresh/logout 全流程
3. **CRUD 全量**：users/roles/permissions/files/audit-logs/error-logs 的 list/create/update/delete 全流程
4. **Zod 校验**：缺字段返回 400 + issues 字段（与 main.ts 一致使用 `SanitizeBodyPipe + ZodValidationPipe + XssPipe`）
5. **权限保护**：无 token 访问受保护接口返回 401；越权访问返回 403
6. **角色-权限绑定**：GET/PUT `/role-permissions/role/:roleId`
7. **路由元数据**：GET `/routes` 返回全部 controller 路由
8. **系统初始化**：GET `/setup/status` + POST `/setup`
9. **WebSocket**：POST `/websocket/notify`（含越权防护）
10. **邮件/微信**：mail/welcome + wechat login（含未启用 503）
11. **定时任务**：POST `/schedule/backup`

> 共 70 个测试用例，文件位置：`apps/server/test/e2e/smoke.e2e-spec.ts`

### 运行

```bash
# 启动 e2e 专用 DB + dev redis（e2e-postgres 独立容器，不污染 DEV DB）
docker compose up -d e2e-postgres redis

# 运行 e2e 冒烟（自动 db:push+seed 到 e2e DB，再跑 vitest）
pnpm --filter=server test:e2e

# CI 环境用 test:e2e:ci（跳过 db:push+seed，由 workflow 单独执行）
pnpm --filter=server test:e2e:ci
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

## Playwright 全链路 e2e

### 定位

Playwright e2e 验证**前端 UI + 后端 API 全链路**，覆盖用户真实操作路径（点击、输入、跳转、WebSocket 通信等）。与 `apps/server/test/e2e/` 的 API 层冒烟测试互补：

| 维度 | API 冒烟（supertest） | 全链路 e2e（Playwright） |
|---|---|---|
| 层级 | 后端 API | 前端 UI + 后端 API |
| 覆盖 | 接口契约、权限、限流 | 用户路径、路由守卫、UI 交互、WebSocket |
| 速度 | 中（秒级） | 慢（分钟级） |
| 依赖 | 真实 DB | 真实 DB + 浏览器 |

### 目录结构

```
apps/e2e/
├── package.json              # @monoforge/e2e
├── playwright.config.ts      # 配置 webServer 自动起 server+web
├── global-setup.ts           # 启动前 seed 测试数据（admin 登录 + 创建 e2e_normal_user/e2e_target_user）
├── global-teardown.ts        # 清理 e2e- 前缀数据（排除夹具账号 normalUser/targetUser）
├── fixtures/                 # 测试夹具（账号、文件）
├── helpers/                  # 辅助函数（API 客户端、浏览器登录、清理）
└── tests/
    ├── auth.spec.ts          # 认证链路（登录/登出/未登录跳转/token 持久化）
    ├── dashboard.spec.ts     # Dashboard 统计显示
    ├── files.spec.ts         # 文件上传 + 软删
    ├── roles.spec.ts         # 角色 CRUD
    ├── permissions.spec.ts   # 权限 CRUD + 路由配置
    ├── role-permissions.spec.ts  # 角色-权限绑定链路 + 角色守卫（409/403）
    ├── routes.spec.ts        # 路由守卫（requireAuth/requirePermission）
    ├── users.spec.ts         # 用户管理 + 提权防护
    ├── websocket.spec.ts     # WebSocket 通知越权
    └── audit-logs.spec.ts    # 审计日志查看
```

### 端口与数据隔离

- e2e postgres: **5433**（独立容器 `mf-e2e-postgres`，与 DEV 5432 完全隔离，DEV DB 零污染）
- e2e redis: **6379**（复用 dev）
- e2e server: **9000**（复用 dev 端口，vite proxy 写死 9000）
- e2e web: **3000**（复用 dev 端口，vite.config.ts + check-port.mjs 写死 3000）

**约束**：e2e 跑时必须停 dev server + dev web（端口冲突）。
**数据隔离**：e2e 用独立 DB（`monoforge_e2e_db`），DEV DB 完全不受影响。`playwright.config.ts` 的 `webServer.command` 启动前自动执行 `db:push && db:seed` 重置 e2e DB，确保每次跑都是干净状态。
**用户名命名**：e2e 用户名必须用下划线（如 `e2e_normal_user`），禁止连字符——`UsernameSchema` 正则为 `^[a-zA-Z0-9_]+$`，含连字符的用户名会在 global-setup 的 `POST /users` 被 Zod 校验拒 400，导致套件 setup 阶段直接失败。

### 运行

```bash
# 1. 启动 e2e 专用 DB + dev redis（e2e-postgres 独立容器，不污染 DEV DB）
docker compose up -d e2e-postgres redis

# 2. 跑全链路 e2e（webServer 自动 db:push+seed 到 e2e DB，再起 server+web，需停 dev server）
pnpm test:e2e

# 3. 查看 HTML 报告
pnpm --filter=@monoforge/e2e test:report

# 4. 重置 e2e DB（删数据卷重建，彻底清空）
docker compose down -v e2e-postgres
docker compose up -d e2e-postgres
```

> 注：`pnpm test:e2e` 走 `pnpm --filter=@monoforge/e2e test`，不经过 turbo，避免 server 历史遗留的 vitest-e2e 配置问题阻塞。

### 编写规范

- 文件位置：`apps/e2e/tests/*.spec.ts`
- 用 Playwright 语义化定位器（`getByRole`、`getByPlaceholder`、`getByText`），避免 CSS 选择器
- 每个测试独立，不依赖执行顺序（虽然 workers=1 串行执行）
- 测试账号用 `e2e-` 前缀（`e2e-normal-user`、`e2e-target-user`、`e2e-temp-*`），便于 global-teardown 清理
- 不删除 admin 账号和 seed 默认数据
- 数据准备走 `helpers/api.ts` 的 `apiClient`，UI 操作走 `helpers/auth.ts`

```ts
import { expect, test } from '@playwright/test'
import { loginAsAdmin } from '@e2e/helpers/auth'

test('admin 查看用户列表', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/users')
  await expect(page.getByText('用户管理', { exact: true })).toBeVisible()
})
```

### CI 集成

实际配置见 `.github/workflows/ci.yml`，共 6 个 job + 1 个聚合 build job：

| Job | 内容 | 依赖 |
|---|---|---|
| `lint` | `pnpm lint`（Biome） | 无 |
| `typecheck` | `tsc --noEmit`（server + web + e2e） | 无 |
| `security` | `bash scripts/security-check.sh` | 无 |
| `unit-test` | `pnpm test`（Mock DB，180+ 用例） | 无 |
| `smoke-test` | `pnpm --filter=server test:e2e:ci`（真实 DB，70 用例） | postgres + redis services |
| `e2e-test` | `pnpm test:e2e`（Playwright，65 用例） | postgres + redis services + playwright install |
| `build` | `pnpm build` | 依赖前 6 个 job 全部通过 |

**push 时 4 个测试链路必须全量通过**：unit-test + smoke-test + e2e-test + security。

## 安全与规范检测

### 自动化脚本

```bash
pnpm security   # 等价于 bash scripts/security-check.sh
```

脚本会执行：

1. **TypeScript 类型检查**：`pnpm -r exec tsc --noEmit`
2. **Biome lint**：`pnpm lint`
3. **软删除过滤审计**：扫描所有 service 是否有 `findFirst/findMany/count()` 缺 `notDeleted`
4. **前端 catch 块审计**：扫描所有 `.tsx` 是否有 `catch {}` 不读 error
5. **环境变量完整性**：对比 `.env` 与 `.env.example` 关键变量
6. **依赖安全扫描**：`pnpm audit --prod`
7. **文档链接有效性**：检查所有 markdown 内部链接指向真实文件
8. **Zod DTO 桥接审计**：扫描 controller 是否有裸 `@Body()`
9. **废弃 API 调用扫描**：用 TypeScript compiler API 的 `DiagnosticTag.Deprecated` 扫描源码中调用了 `@deprecated` 符号的位置（`tsc --noEmit` 不会输出、但 IDE 会划删除线的项），脚本为 `scripts/check-deprecated.cjs`

## 测试数据管理

### 种子数据

- 生产种子：`apps/server/src/db/seed.ts`（admin 账号 + 初始权限）
- 测试种子：e2e 测试内部自建（不依赖生产 seed）

### 数据隔离

- 单测：全部 mock，不碰真实 DB
- E2E：用真实 DB，每个测试 `beforeEach` truncate
- 生产：禁止 `db:seed`（除非首次部署）

## CI/CD 集成

实际 CI 配置见 `.github/workflows/ci.yml`，push 时触发 6 个并行 job（lint / typecheck / security / unit-test / smoke-test / e2e-test），全部通过后聚合 build job 执行 `pnpm build`。

**4 个测试链路全量通过门槛**：
- `unit-test`：`pnpm test`（后端 180+ + 前端 hooks 单测）
- `smoke-test`：`pnpm --filter=server test:e2e:ci`（70 个 API 冒烟）
- `e2e-test`：`pnpm test:e2e`（65 个 Playwright 全链路）
- `security`：`bash scripts/security-check.sh`（lint + typecheck + 软删除审计 + 依赖安全扫描）
