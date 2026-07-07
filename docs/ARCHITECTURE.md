# 架构设计

---

## 项目概述

MB 全栈 Monorepo 是一个可复用的中后台全栈脚手架，基于 pnpm workspace + Turborepo 管理，前后端共享 zod 契约实现端到端类型安全。

---

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

---

## 目录结构

```
mb-monorepo/
├── apps/
│   ├── web/                      # 前端 (React 19 + Vite 8 + antd6 + TanStack)
│   │   ├── src/
│   │   │   ├── routes/           # TanStack Router 文件式路由
│   │   │   ├── components/       # 通用组件
│   │   │   ├── hooks/            # 自定义 hooks
│   │   │   ├── stores/           # Zustand stores
│   │   │   └── lib/              # 工具函数
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   └── server/                   # 后端 (NestJS 11 + Drizzle + PostgreSQL)
│       ├── src/
│       │   ├── modules/          # 业务模块
│       │   │   ├── auth/         # 认证模块
│       │   │   ├── users/        # 用户模块
│       │   │   ├── roles/        # 角色模块
│       │   │   ├── error-logs/   # 错误日志模块
│       │   │   └── audit-logs/   # 审计日志模块
│       │   ├── common/           # 公共模块 (guards, interceptors, filters)
│       │   ├── db/               # Drizzle schema + 迁移
│       │   └── config/           # 配置校验 (zod)
│       ├── drizzle/
│       ├── drizzle.config.ts
│       └── tsconfig.json
├── packages/
│   ├── shared/                   # zod schemas + 派生类型 + 常量/错误码
│   │   └── schemas/
│   │       ├── user.schema.ts
│   │       ├── role.schema.ts
│   │       ├── auth.schema.ts
│   │       ├── error-log.schema.ts
│   │       ├── audit-log.schema.ts
│   │       └── pagination.schema.ts
│   └── config/                   # 共享 biome/tsconfig
├── docs/
│   └── ARCHITECTURE.md
├── .github/workflows/ci.yml
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── AGENTS.md
└── .env.example
```

---

## 数据库设计

### users 表

| 列 | 类型 | 说明 |
|---|---|---|
| id | serial PK | 主键 |
| username | varchar(50) UNIQUE | 用户名 |
| email | varchar(100) UNIQUE | 邮箱 |
| password | varchar(255) | argon2 哈希 |
| nickname | varchar(50) | 昵称 |
| avatar | varchar(255) | 头像 URL |
| phone | varchar(20) | 手机号 |
| role_id | integer FK → roles.id | 角色 ID |
| status | boolean DEFAULT true | 是否启用 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### roles 表

| 列 | 类型 | 说明 |
|---|---|---|
| id | serial PK | 主键 |
| name | varchar(50) UNIQUE | 角色名 |
| description | text | 描述 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### error_logs 表

| 列 | 类型 | 说明 |
|---|---|---|
| id | serial PK | 主键 |
| message | text | 错误消息 |
| stack | text | 堆栈信息 |
| context | jsonb | 上下文信息 |
| user_id | integer FK → users.id | 操作用户 |
| ip | varchar(45) | 客户端 IP |
| user_agent | text | User-Agent |
| created_at | timestamp | 创建时间 |

### error_whitelist 表

| 列 | 类型 | 说明 |
|---|---|---|
| id | serial PK | 主键 |
| pattern | text | 白名单匹配模式 |
| description | text | 说明 |
| is_active | boolean DEFAULT true | 是否启用 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### audit_logs 表

| 列 | 类型 | 说明 |
|---|---|---|
| id | serial PK | 主键 |
| user_id | integer FK → users.id | 操作用户 |
| action | varchar(50) | 操作类型 (create/update/delete) |
| resource | varchar(50) | 资源类型 (user/role/error_whitelist) |
| resource_id | integer | 资源 ID |
| old_value | jsonb | 变更前数据 |
| new_value | jsonb | 变更后数据 |
| ip | varchar(45) | 客户端 IP |
| user_agent | text | User-Agent |
| created_at | timestamp | 创建时间 |

---

## API 设计

### 规范

- 前缀: `/api/v1`
- 风格: RESTful
- 认证: JWT Bearer Token (Authorization: Bearer <access_token>)
- 响应格式:

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

### 核心路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | /api/v1/auth/login | 登录 | 否 |
| POST | /api/v1/auth/refresh | 刷新 token | 否 (cookie) |
| POST | /api/v1/auth/logout | 登出 | 是 |
| GET | /api/v1/auth/profile | 获取当前用户信息 | 是 |
| GET | /api/v1/health | 健康检查 | 否 |
| GET | /api/v1/users | 用户列表 | 是 |
| POST | /api/v1/users | 创建用户 | 是 |
| GET | /api/v1/users/:id | 用户详情 | 是 |
| PUT | /api/v1/users/:id | 更新用户 | 是 |
| DELETE | /api/v1/users/:id | 删除用户 | 是 |
| GET | /api/v1/roles | 角色列表 | 是 |
| POST | /api/v1/roles | 创建角色 | 是 |
| PUT | /api/v1/roles/:id | 更新角色 | 是 |
| DELETE | /api/v1/roles/:id | 删除角色 | 是 |
| GET | /api/v1/error-logs | 错误日志列表 | 是 |
| DELETE | /api/v1/error-logs/:id | 删除错误日志 | 是 |
| POST | /api/v1/error-whitelist | 创建白名单 | 是 |
| PUT | /api/v1/error-whitelist/:id | 更新白名单 | 是 |
| DELETE | /api/v1/error-whitelist/:id | 删除白名单 | 是 |
| GET | /api/v1/audit-logs | 审计日志列表 | 是 |

---

## 认证设计

### JWT 双 Token 机制

| Token | 有效期 | 存储位置 | 用途 |
|---|---|---|---|
| access_token | 15 分钟 | Authorization Header | API 认证 |
| refresh_token | 7 天 | HttpOnly Cookie + Redis | 刷新 access_token |

### 流程

1. **登录**: 用户名密码 → argon2 校验 → 签发 access + refresh → refresh 存 Redis
2. **刷新**: 旧 refresh 验证 → Redis 删除旧 refresh → 签发新 access + refresh → 新 refresh 存 Redis (轮换)
3. **登出**: 删除 Redis 中的 refresh → 清除 cookie

### 安全

- refresh_token 使用 HttpOnly + Secure + SameSite=Strict Cookie
- argon2id 哈希密码
- Refresh Token 在 Redis 中存储，支持多设备登录与强制登出

---

## 前端架构

### 路由 (TanStack Router)

```
src/routes/
├── __root.tsx                    # 根路由 (布局 + 全局 provider)
├── _authenticated.tsx             # 需认证的路由组
│   ├── index.tsx                  # 首页
│   ├── users/
│   │   ├── index.tsx              # 用户列表
│   │   └── $userId.tsx            # 用户详情
│   ├── roles/
│   │   └── index.tsx              # 角色列表
│   └── error-logs/
│       └── index.tsx              # 错误日志
├── login.tsx                      # 登录页
└── not-found.tsx                  # 404 页
```

### 数据层 (TanStack Query)

- 所有 API 调用通过 `useQuery` / `useMutation` 管理
- 统一 queryKey 约定: `['模块', '资源', { params }]`
- 全局 QueryClient 配置: retry 3 次、staleTime 5 分钟

### 主题 (Tailwind v4 + antd6)

- antd6 开启 cssVar 模式，输出 `--ant-*` 变量
- Tailwind `@theme` 引用 `var(--ant-*)` 做单一主题源
- Preflight 收窄，避免与 antd 组件冲突
- 分工: antd 管组件样式，Tailwind 管布局样式

### RBAC 权限

- 路由级: `<AuthGuard>` 组件守卫
- 按钮级: `<HasPermission code="xxx">` 组件控制

---

## 共享契约

### zod Schema 单一源

```
packages/shared/schemas/
├── user.schema.ts        # 用户相关 schema
├── role.schema.ts        # 角色相关 schema
├── auth.schema.ts        # 认证相关 schema
├── error-log.schema.ts   # 错误日志 schema
├── audit-log.schema.ts   # 审计日志 schema
└── pagination.schema.ts  # 统一分页 schema
```

### 使用方式

**后端**: `nestjs-zod` 桥接 zod 做 DTO 校验 + `zod-to-openapi` 生成 OpenAPI spec

```typescript
// 后端 DTO 校验
import { createZodDto } from 'nestjs-zod';
import { CreateUserSchema } from '@mb/shared/schemas';

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
```

**前端**: `z.infer` 派生 TS 类型 + `zodResolver` 做表单校验

```typescript
// 前端类型派生
import { CreateUserSchema } from '@mb/shared/schemas';
import type { z } from 'zod';

type CreateUser = z.infer<typeof CreateUserSchema>;
```

---

## 部署架构

### Docker Compose 服务

| 服务 | 端口 | 说明 |
|---|---|---|
| postgres | 5432 | PostgreSQL 16 |
| redis | 6379 | Redis 7 |
| app | 9000 | NestJS 后端（含前端 dist，单一入口） |

### Dockerfile 策略

- **单一入口**：根 `Dockerfile` 多阶段构建，同时编译 shared → server → web，最终运行 `node apps/server/dist/main.js`
- 前端 `dist` 由后端 `ServeStaticModule` 托管，无需独立 nginx 容器
- 详见 [DEPLOYMENT.md](./DEPLOYMENT.md)

### 环境变量

所有环境变量通过 `.env` 文件管理，关键变量缺失时服务启动即失败。详见 `.env.example` 和 [CONFIGURATION.md](./CONFIGURATION.md)。

---

## 相关文档

- [编码规范](./CONVENTIONS.md)
- [数据库规范](./DATABASE.md)
- [异常处理规范](./ERROR-HANDLING.md)
- [安全规范](./SECURITY.md)
- [配置规范](./CONFIGURATION.md)
