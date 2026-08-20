# 架构设计

---

## 项目概述

MonoForge 全栈 Monorepo 是一个可复用的中后台全栈脚手架，基于 pnpm workspace + Turborepo 管理，前后端共享 zod 契约实现端到端类型安全。

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
monoforge/
├── apps/
│   ├── web/                      # 前端 (React 19 + Vite 8 + antd6 + TanStack)
│   │   ├── src/{routes,components,hooks,stores,lib}
│   │   └── vite.config.ts
│   └── server/                   # 后端 (NestJS 11 + Drizzle + PostgreSQL)
│       ├── src/{modules,common,db,config}
│       └── drizzle/
├── packages/
│   └── shared/                   # zod schemas + 派生类型 + 常量/错误码
│       └── schemas/               # user.ts / role.ts / auth.ts / error-log.ts / audit-log.ts / pagination.ts
├── docs/                          # 技术规范文档
├── scripts/security-check.sh     # 安全检测脚本
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
└── .env.example
```

---

## 数据库设计

核心业务表：`users` / `roles` / `permissions` / `role_permissions` / `files` / `notifications` / `error_logs` / `error_whitelist` / `audit_logs`。

所有业务表均含 `deleted_at` 软删除字段；`audit_logs` 为 append-only 表例外。详细表结构与字段说明见 [DATABASE.md](./DATABASE.md)。

---

## API 设计

### 规范

- 前缀: `/api/v1`
- 风格: RESTful
- 认证: JWT Bearer Token (Authorization: Bearer <access_token>)
- 统一响应格式（由 `ResponseInterceptor` 包装）：

```json
{
  "code": 200,
  "message": "成功",
  "data": {}
}
```

### 核心路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | /api/v1/auth/login | 登录 | 否 |
| POST | /api/v1/auth/refresh | 刷新 token | 否 (cookie) |
| POST | /api/v1/auth/logout | 登出 | 是 |
| GET | /api/v1/auth/me | 获取当前用户信息 | 是 |
| GET | /api/v1/health | 健康检查 | 否 |
| GET/POST | /api/v1/users | 用户列表/创建 | 是 |
| GET/PATCH/DELETE | /api/v1/users/:id | 用户详情/更新/删除 | 是 |
| GET/POST | /api/v1/roles | 角色列表/创建 | 是 |
| PATCH/DELETE | /api/v1/roles/:id | 角色更新/删除 | 是 |
| GET/POST | /api/v1/permissions | 权限列表/创建 | 是 |
| PATCH/DELETE | /api/v1/permissions/:id | 权限更新/删除 | 是 |
| PUT | /api/v1/role-permissions/role/:roleId | 配置角色权限 | 是 |
| GET | /api/v1/error-logs | 错误日志列表 | 是 |
| GET | /api/v1/error-logs/:id | 错误日志详情 | 是 |
| GET | /api/v1/error-logs/stats | 错误日志统计 | 是 |
| GET | /api/v1/error-logs/grouped | 错误聚合 Top N | 是 |
| POST | /api/v1/error-logs/report | 前端错误上报 | 否 |
| POST | /api/v1/error-logs/:id/resolve | 标记已处理 | 是 |
| POST | /api/v1/error-logs/batch-resolve | 批量标记已处理 | 是 |
| DELETE | /api/v1/error-logs/:id | 删除错误日志 | 是 |
| GET/POST | /api/v1/error-logs/whitelist | 白名单列表/创建 | 是 |
| PATCH/DELETE | /api/v1/error-logs/whitelist/:id | 白名单更新/删除 | 是 |
| GET | /api/v1/audit-logs | 审计日志列表 | 是 |
| GET | /api/v1/audit-logs/:id | 审计日志详情 | 是 |
| GET | /api/v1/files | 文件列表 | 是 |
| POST | /api/v1/files/upload | 上传文件 | 是 |
| DELETE | /api/v1/files/:id | 删除文件 | 是 |
| POST | /api/v1/mail/welcome | 发送欢迎邮件 | 是 |
| POST | /api/v1/mail/verification-code | 发送验证码邮件 | 是 |
| POST | /api/v1/schedule/backup | 手动触发数据库备份 | 是 |
| GET | /api/v1/notifications | 通知列表 | 是 |
| GET | /api/v1/notifications/unread-count | 未读通知数 | 是 |
| POST | /api/v1/notifications/:id/read | 标记通知已读 | 是 |
| POST | /api/v1/notifications/read-all | 全部标记已读 | 是 |
| DELETE | /api/v1/notifications/:id | 删除通知 | 是 |
| WS | / | WebSocket 实时推送 | 是 |

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
3. **登出**: 删除 Redis 中全部 refresh + 批量吊销该用户所有活跃 access token（jti 黑名单）→ 清除 cookie

### 安全

- refresh_token 使用 HttpOnly + Secure + SameSite=Strict Cookie
- argon2id 哈希密码
- Refresh Token 在 Redis 中存储，支持多设备登录与强制登出

---

## WebSocket 架构

### 心跳探测

- 服务端 `@WebSocketGateway` 显式配置 `pingInterval: 10000` + `pingTimeout: 5000`
- 默认 25s+20s=45s 太慢，用户离线感知延迟过长
- 配置后最坏离线感知从 45s 降到 15s

### 在线状态实时推送

- 后端 `handleConnection`/`handleDisconnect` 在用户首次上线/全部断开时广播 `presence:update` 事件
- 前端 `use-websocket.ts` 订阅 `presence:update` 事件，用 `queryClient.setQueryData` 增量更新
- **不再走 10s HTTP 轮询**，状态变更 <1s 到达 UI

### 多实例与权限过滤

- 在线状态存 Redis Set（`ws:online:{userId}`），多实例部署下经 Redis adapter（`@socket.io/redis-adapter`）跨实例广播
- presence 事件通过 `presence:watchers` room 定向广播：仅持 `notification:view` 或 admin 的连接加入，权限变更（60s 重校验）时动态调整 room 成员，无权限连接收不到在线状态数据

### 前端应用层心跳

- `ws.ts` 的 `HEARTBEAT_INTERVAL = 10_000`（10s 一次 ping）
- 加 pong 超时检测：5s 内未收到 pong 主动 `socket.disconnect()` 触发重连
- 重连指数退避：1s/2s/4s/8s/10s，最多 5 次

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
import { CreateUserSchema } from '@monoforge/shared/schemas';

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
```

**前端**: `z.infer` 派生 TS 类型 + `zodResolver` 做表单校验

```typescript
// 前端类型派生
import { CreateUserSchema } from '@monoforge/shared/schemas';
import type { z } from 'zod';

type CreateUser = z.infer<typeof CreateUserSchema>;
```

---

## 部署架构

### Docker Compose 服务

| 服务 | 端口 | 说明 |
|---|---|---|
| postgres | 5432 | PostgreSQL 16（独立容器 mf-postgres，monoforge 占最前位） |
| redis | 6379 | Redis 7（独立容器 mf-redis，monoforge 占最前位） |
| app | 9000 | NestJS 后端（含前端 dist，单一入口） |

### Dockerfile 策略

- **单一入口**：根 `Dockerfile` 多阶段构建（prod-deps → builder → runner），同时编译 shared → server → web；runner 仅带生产依赖三层 node_modules + dist 产物
- 容器启动先执行数据库迁移（`dist/db/migrate.js`）再启动服务（`dist/main.js`），详见 [DEPLOYMENT.md](./DEPLOYMENT.md)
- 前端 `dist` 由后端 `ServeStaticModule` 托管，无需独立 nginx 容器
- `uploads/` 目录也由 `ServeStaticModule` 托管（`serveRoot: /uploads`），文件上传/导出的 URL 可直接访问

### 前端构建优化

`vite.config.ts` 通过 `build.rollupOptions.output.manualChunks` 拆分大依赖：

| chunk | 内容 |
|---|---|
| `vendor-react` | react + react-dom |
| `vendor-router` | @tanstack/react-router + @tanstack/react-query |
| `vendor-antd` | antd + @ant-design/icons |

### 原生模块构建

根 `package.json` 的 `pnpm.onlyBuiltDependencies` 预置了需要构建脚本的原生依赖（`@swc/core`、`esbuild`、`argon2`、`msw`），pnpm install 后自动执行构建脚本。

### 环境变量

所有环境变量通过 `.env` 文件管理，关键变量缺失时服务启动即失败。详见 `.env.example` 和 [CONFIGURATION.md](./CONFIGURATION.md)。

---

## 相关文档

- [编码规范](./CONVENTIONS.md)
- [数据库规范](./DATABASE.md)
- [异常处理规范](./ERROR-HANDLING.md)
- [安全规范](./SECURITY.md)
- [配置规范](./CONFIGURATION.md)
