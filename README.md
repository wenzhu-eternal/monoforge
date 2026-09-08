# MonoForge 全栈 Monorepo

可复用的中后台全栈脚手架，基于 pnpm workspace + Turborepo 管理，前后端共享 zod 契约实现端到端类型安全。

## 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架(后端) | NestJS | ^11.1.27 |
| ORM | Drizzle ORM | ^0.45.2 |
| 数据库 | PostgreSQL | 16 |
| 缓存 | Redis | 7 |
| 校验 | Zod | ^4.4.3 |
| 框架(前端) | React | ^19.2.7 |
| 构建 | Vite + SWC | ^8.1.0 |
| 路由 | TanStack Router | ^1.170.16 |
| 数据层 | TanStack Query | ^5.101.2 |
| UI | Ant Design | ^6.5.0 |
| 样式 | Tailwind CSS | v4 ^4.3.1 |
| 本地态 | Zustand | ^5.0.14 |
| Lint/Format | Biome | ^2.5.2 |
| Monorepo | pnpm + Turborepo | turbo ^2.10.3 |
| 测试 | Vitest | ^4.1.9 |

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- Docker & Docker Compose（用于 PostgreSQL/Redis/生产构建）
- PostgreSQL 16
- Redis 7
- pnpm

### 安装依赖

```bash
pnpm install
```

### 环境配置

复制 `.env.example` 到 `.env` 并配置环境变量：

```bash
cp .env.example .env
```

> **重要**：`JWT_SECRET` 和 `JWT_REFRESH_SECRET` 是占位符，必须替换为随机密钥（`openssl rand -base64 48`），否则服务启动时会拒绝运行。

### 启动开发服务

```bash
# 启动所有服务
pnpm dev

# 只启动前端
pnpm dev --filter=web

# 只启动后端
pnpm dev --filter=server
```

### 数据库初始化

```bash
# 生成迁移文件
pnpm db:generate

# 执行迁移
pnpm db:migrate

# 种子数据
pnpm db:seed
```

## 开发命令

```bash
# 开发
pnpm dev                    # 启动所有服务
pnpm dev --filter=web       # 只启动前端
pnpm dev --filter=server    # 只启动后端

# 构建
pnpm build                  # 构建所有包

# 测试
pnpm test                   # 运行所有测试

# Lint
pnpm lint                   # 检查所有包
pnpm lint:fix               # 自动修复
pnpm format                 # 格式化代码

# 数据库
pnpm db:generate            # 生成迁移文件
pnpm db:migrate             # 执行迁移
pnpm db:seed                # 种子数据

# Docker
docker compose up           # 启动所有服务
docker compose up postgres  # 只启动数据库
docker compose up redis     # 只启动 Redis
```

## 项目结构

```
monoforge/
├── apps/
│   ├── web/          # 前端 (React 19 + Vite 8 + antd6 + TanStack)
│   ├── server/       # 后端 (NestJS 11 + Drizzle + PostgreSQL)
│   └── e2e/          # 端到端测试 (Playwright)
├── packages/
│   ├── shared/       # zod schemas + 派生类型 + 常量/错误码
├── docs/             # 技术规范文档
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── biome.json
```

## 契约铁律

1. **改 API 必须先改 `packages/shared/schemas`**
2. **禁止前端手抄类型** - 所有类型从 shared 导出
3. **禁止后端绕过 zod 自定义 DTO** - 使用 nestjs-zod 桥接
4. **错误码集中到 shared** - 前后端共享

## 测试要求

1. 新增 service/controller 必须配套单测
2. bug 修复先写复现测试
3. 所有 AI 改动须经 `pnpm test` + Biome 通过方可提交

## 基于 Monoforge 创建新项目

1. **修改项目标识**
   - 根目录 `package.json` 的 `name` 字段
   - `.env` 的 `APP_NAME`、`VITE_APP_NAME`、`VITE_APP_SHORT_NAME`
   - `Dockerfile` 中的应用名（如有）

2. **替换密钥**
   - 生成 JWT 双密钥：`openssl rand -base64 48`（分别填入 `JWT_SECRET` 和 `JWT_REFRESH_SECRET`）
   - 修改 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`

3. **初始化管理员**
   - 方式一（推荐）：启动服务后访问 `/setup`，填管理员账号密码
   - 方式二：`pnpm db:seed`（使用 `.env` 中的 `SEED_ADMIN_*`）

4. **添加新模块**
   - 后端：`apps/server/src/modules/` 下新建模块目录（参照 `users` 模块结构），在 `app.module.ts` 注册
   - 前端：`apps/web/src/routes/` 下新建路由，`apps/web/src/hooks/` 下新建对应 hook
   - 共享契约：`packages/shared/src/schemas/` 下新建 zod schema，前后端共享

5. **启动验证**
   ```bash
   docker compose up -d postgres redis
   pnpm install
   pnpm db:migrate
   pnpm db:seed
   pnpm dev
   ```

## 相关文档

- [架构设计](./docs/ARCHITECTURE.md)
- [部署规范](./docs/DEPLOYMENT.md)
- [编码规范](./docs/CONVENTIONS.md)
- [数据库规范](./docs/DATABASE.md)
- [异常处理规范](./docs/ERROR-HANDLING.md)
- [安全规范](./docs/SECURITY.md)
- [配置规范](./docs/CONFIGURATION.md)
- [测试规范](./docs/TESTING.md)
- [编辑器配置](./docs/EDITOR-SETUP.md)
- [antd v6 迁移指南](https://ant.design/docs/react/migration-v6/)
- [Drizzle ORM 文档](https://orm.drizzle.team/docs)
- [TanStack Router](https://tanstack.com/router/latest)