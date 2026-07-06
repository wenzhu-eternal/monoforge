# MB 全栈 Monorepo 项目指引

## 项目概览

- **类型**: 全栈 monorepo，前后端共享 zod 契约
- **技术栈**: React 19 + NestJS 11 + Drizzle + PostgreSQL + TanStack + antd6 + Tailwind v4
- **目标**: 可复用的中后台全栈脚手架，端到端类型安全

## 目录约定

```
mb-monorepo/
├── apps/
│   ├── web/          # 前端 (React 19 + Vite 8 + antd6 + TanStack)
│   └── server/       # 后端 (NestJS 11 + Drizzle + PostgreSQL)
├── packages/
│   ├── shared/       # zod schemas + 派生类型 + 常量/错误码
│   └── config/       # 共享 biome/tsconfig
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

## 数据库铁律

1. **禁止 `synchronize`** - 所有表结构变更走 `drizzle-kit generate` 迁移
2. **表名使用 snake_case 复数** - `users` / `roles` / `error_logs`
3. **使用 PostgreSQL** - JSONB 存可变结构
4. **软删除** - 所有表添加 `deleted_at` 字段，删除操作仅设置时间戳，查询时过滤 `deleted_at IS NULL`

## 命名规范

- **文件**: 模块单文件 `{module}.ts`; drizzle 表定义用 `*.schema.ts`; TanStack Router 路由用 `*.route.ts`
- **类**: `{Resource}{Type}` 驼峰后缀 - `UserController` / `UserService`
- **DTO**: `{Action}{Resource}Dto` - `CreateUserDto` / `LoginDto` (全部命名导出)
- **Provider/Module**: 命名导出 + 模块聚合 (`index.module.ts`)

## 命令速查

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

## 测试要求

1. **新增 service/controller 必须配套单测**
2. **bug 修复先写复现测试**
3. **所有 AI 改动须经 `pnpm test` + Biome 通过方可提交**

## 开发流程

1. **先描述后编码**: 编写任何代码前，先描述方案并等待批准
2. **需求模糊时先澄清**: 提出澄清问题，确认后再动手
3. **任务拆分**: 修改超过 3 个文件时，先停止并拆分成更小的任务
4. **被纠正即反思**: 反思错误原因并制定永不再犯的对策

## 环境要求

- **包管理器**: pnpm (优先)
- **终端**: zsh
- **系统工具**: 优先使用 brew 安装
- **Node.js**: >= 20.0.0
- **PostgreSQL**: 16
- **Redis**: 7

## 参考文档

- [架构设计](./docs/ARCHITECTURE.md)
- [antd v6 迁移指南](https://ant.design/docs/react/migration-v6/)
- [Drizzle ORM 文档](https://orm.drizzle.team/docs)
- [TanStack Router](https://tanstack.com/router/latest)

## 前端交互规范

1. **Table 样式**：所有 `<Table>` 必须加 `bordered`，多操作按钮用 `<Divider type="vertical" style={{ margin: '0 4px' }} />` 分隔，操作按钮统一 `type="link" size="small"`
2. **错误提示**：加载失败用 `message.useMessage()` + `useEffect` 监听 `isError` 弹 toast，不再用 `<Alert>` 常驻；`contextHolder` 紧跟外层组件
3. **布局**：顶部不再用 `<Card>` 包裹 Table，标题行右侧放主操作按钮（如"新建"/"上传"）
4. **antd 中文化**：`__root.tsx` 的 `ConfigProvider` 必须配 `locale={zhCN}`，所有 Modal/Popconfirm 默认显示"确定/取消"，不再为每个弹窗单独写 `okText/cancelText`
5. **菜单跳转**：`handleMenuClick` 必须判断 `key.startsWith('/')` 才跳转，分组节点 key（如 `'system'`/`'log'`/`'content'`）不触发 `navigate`
6. **菜单可见性**：admin 专属菜单（如邮件发送）基于 `user?.roles?.some(r => r.name === 'admin')` 判断；普通业务菜单基于 `hasPermission(Permissions.XXX)`

## 错误日志规范

1. **入库链路**：所有后端错误必须经 `ErrorLogsService.record()` 入库，禁止在 ExceptionFilter 或其他位置直接 `db.insert(errorLogs)`，以确保 `errorType` 与白名单缓存一致
2. **聚合查询**：`findGrouped` 必须 `where eq(isResolved=false)`，全处理后聚合列表自动隐藏
3. **限流豁免**：error-logs 模块的只读接口（findAll/stats/grouped/whitelist）必须 `@SkipThrottle()`，避免 429

## 数据库 helpers 规范

1. **`notDeleted(deletedAt)` 仅传单列**：正确用法 `and(eq(col, val), notDeleted(deletedAt))`；错误用法 `notDeleted(id, deletedAt)` 会把所有传入列都判 `IS NULL` → 永远查不到记录
2. **删除绑定校验**：删除实体前必须检查外键引用（如 rolePermissions / users.roleId），存在未软删的引用则抛 `ConflictException`