# AI 协作规则

> 本文件仅保留 AI 协作流程铁律与文档索引。所有技术规范已拆分到 `docs/` 下独立文件。

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
├── docs/             # 技术规范文档（见下方索引）
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── biome.json
```

## 命令速查

```bash
# 开发
pnpm dev                    # 启动所有服务
pnpm dev --filter=web       # 只启动前端
pnpm dev --filter=server    # 只启动后端

# 构建
pnpm build                  # 构建所有包
pnpm --filter=shared build  # 单独构建 shared（schema 改动后必须执行）

# 测试
pnpm test                   # 运行所有单元测试
pnpm --filter=server test:e2e  # 运行 e2e 冒烟测试（需真实 DB）

# 质量检测
pnpm lint                   # Biome lint 检查所有包
pnpm lint:fix               # 自动修复
pnpm format                 # 格式化代码
pnpm security               # 安全 + 兼容性 + 规范检测（详见 docs/TESTING.md）

# 数据库
pnpm db:generate            # 生成迁移文件
pnpm db:migrate             # 执行迁移
pnpm db:seed                # 种子数据

# Docker
docker compose up           # 启动所有服务
docker compose up postgres  # 只启动数据库
docker compose up redis     # 只启动 Redis
```

## 环境要求

- **包管理器**: pnpm (优先)
- **终端**: zsh
- **系统工具**: 优先使用 brew 安装
- **Node.js**: >= 20.0.0
- **PostgreSQL**: 16
- **Redis**: 7

## 开发流程铁律

1. **先描述后编码**: 编写任何代码前，先描述方案并等待批准，不得直接动手
2. **需求模糊时先澄清**: 提出澄清问题，确认后再动手
3. **任务拆分**: 一项任务需修改超过 3 个文件时，先停止并拆分成更小的任务
4. **被纠正即反思**: 每次被纠正时，反思错误原因并制定永不再犯的对策
5. **完成代码后列边缘场景**: 列出边缘 case 并建议覆盖它们的测试用例
6. **Bug 修复先写复现测试**: 出现 bug 时，先写能复现的测试，再修复，直到测试通过
7. **不主动 push**: 不主动执行 `git push`，等待用户确认后再执行
8. **避免过度优化**: 不滥用 `useCallback`/`useMemo`，仅在确有性能问题时使用，默认写简单清晰的代码

## 测试要求

1. **新增 service/controller 必须配套单测**
2. **bug 修复先写复现测试**
3. **所有 AI 改动须经 `pnpm test` + Biome 通过方可提交**

## 文档索引

所有技术规范已拆分到 `docs/` 下，按职责分文件维护：

| 文档 | 职责 |
|---|---|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 架构设计（技术栈/目录/DB schema/API/认证/部署） |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 部署规范（对外单一入口/ngrok/Docker/生产检查清单） |
| [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) | 编码规范（契约铁律/命名/前端交互/表单/Zod DTO 桥接/提交规范） |
| [docs/DATABASE.md](./docs/DATABASE.md) | 数据库规范（表结构铁律/软删除过滤/helpers/迁移） |
| [docs/ERROR-HANDLING.md](./docs/ERROR-HANDLING.md) | 异常处理（错误日志入库/HttpExceptionFilter/前端 catch） |
| [docs/SECURITY.md](./docs/SECURITY.md) | 安全规范（认证链路/admin 保护/文件上传/限流/CORS） |
| [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) | 配置规范（环境变量/陷阱/邮件服务/ngrok 部署） |
| [docs/TESTING.md](./docs/TESTING.md) | 测试规范（单测/e2e 冒烟/安全检测/覆盖率要求） |
| [docs/EDITOR-SETUP.md](./docs/EDITOR-SETUP.md) | 编辑器配置（VSCode/Biome/husky/EditorConfig） |

## 外部参考文档

- [antd v6 迁移指南](https://ant.design/docs/react/migration-v6/)
- [Drizzle ORM 文档](https://orm.drizzle.team/docs)
- [TanStack Router](https://tanstack.com/router/latest)
