# MB 全栈 Monorepo

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
| 表单 | react-hook-form | ^7.80.0 |
| Lint/Format | Biome | ^2.5.1 |
| Monorepo | pnpm + Turborepo | turbo ^2.10.0 |
| 测试 | Vitest | ^4.1.9 |

## 快速开始

### 环境要求

- Node.js >= 20.0.0
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
mb-monorepo/
├── apps/
│   ├── web/          # 前端 (React 19 + Vite 8 + antd6 + TanStack)
│   └── server/       # 后端 (NestJS 11 + Drizzle + PostgreSQL)
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

## 相关文档

- [架构设计](./docs/ARCHITECTURE.md)
- [编码规范](./docs/CONVENTIONS.md)
- [数据库规范](./docs/DATABASE.md)
- [异常处理规范](./docs/ERROR-HANDLING.md)
- [安全规范](./docs/SECURITY.md)
- [配置规范](./docs/CONFIGURATION.md)
- [antd v6 迁移指南](https://ant.design/docs/react/migration-v6/)
- [Drizzle ORM 文档](https://orm.drizzle.team/docs)
- [TanStack Router](https://tanstack.com/router/latest)