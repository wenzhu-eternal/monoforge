# 部署规范

## 对外单一入口架构

> 所有外部流量统一通过后端 9000 端口进入，由后端决定返回 API 响应还是前端静态资源。前端不直接对外暴露。

### 架构图

```
公网 / ngrok ──→ [NestJS :9000]
                     │
              ┌──────┴───────┐
              ▼              ▼
        /api/v1/*      /* (其他所有路径)
         前缀路由         ServeStaticModule
              │              │
              ▼              ▼
         NestJS 路由    apps/web/dist/
         (Controller)   (前端构建产物)
              │
              ▼
       PostgreSQL + Redis
```

### 核心设计：ServeStaticModule 托管前端

- 后端通过 `ServeStaticModule` 托管前端 `dist` 目录
- `exclude: ['/api/{*path}']` 保证 `/api/*` 路由由 NestJS 处理，其他所有路径返回前端 `index.html`
- 单一端口同时提供 API 和前端，避免 CORS、简化部署、便于 ngrok 隧道

```ts
// apps/server/src/app.module.ts
ServeStaticModule.forRoot({
  rootPath: join(__dirname, '..', '..', 'web', 'dist'),
  exclude: ['/api/{*path}'],
}),
```

## 部署流程

### 标准部署（一次性）

```bash
# 1. 构建所有产物
pnpm build

# 2. 执行数据库迁移
pnpm db:migrate

# 3. （可选）填充种子数据
pnpm db:seed

# 4. 启动后端（同时托管前端 + 提供 API）
NODE_ENV=production node apps/server/dist/main
```

### ngrok 临时外网部署

```bash
# 1. 构建前端产物（后端托管）
pnpm --filter=@mb/web build

# 2. 启动后端服务
pnpm --filter=server dev

# 3. 启动 ngrok 隧道（绑后端端口）
ngrok http 127.0.0.1:9000

# 4. 验证（替换 URL 为 ngrok 输出的公网地址）
curl https://xxx.ngrok-free.dev/                      # 前端 HTML
curl https://xxx.ngrok-free.dev/api/v1/health        # API 健康检查
```

### 关键约束

- **ngrok 必须绑 `127.0.0.1:9000`**，不能绑 3000（vite dev server）。原因：后端通过 ServeStaticModule 做静态资源中转，单一端口同时处理 API 和前端
- **Vite 配置**：`host: '0.0.0.0'`（IPv4）+ `strictPort: true` + `.ngrok-free.dev` 加入 `allowedHosts`

## 健康检查

部署后验证：

```bash
# 1. 前端可达
curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/
# 期望：200

# 2. 后端 API 可达
curl -s http://localhost:9000/api/v1/health
# 期望：{"status":"ok","database":"ok","redis":"ok"}

# 3. Swagger 文档（仅非生产环境）
curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/api/docs
# 期望：200（生产环境应为 404）
```

## 生产环境检查清单

部署前必查：

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` / `JWT_REFRESH_SECRET` 已设置为强随机字符串（>= 32 字符）
- [ ] `ALLOW_ORIGIN` 已设为生产域名（非 `*`）
- [ ] Cookie `secure` flag 已通过环境变量开启
- [ ] Swagger 已关闭（`NODE_ENV=production` 时自动隐藏）
- [ ] 数据库备份已创建
- [ ] 迁移已执行（`pnpm db:migrate`）
- [ ] `pnpm test` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm security` 通过（详见 [TESTING.md](./TESTING.md)）

## Docker 部署

```bash
# 启动所有服务（postgres + redis + server + web）
docker compose up -d

# 查看日志
docker compose logs -f server

# 停止
docker compose down
```

### docker-compose 服务编排

| 服务 | 端口 | 依赖 | 说明 |
|---|---|---|---|
| postgres | 5432 | - | PostgreSQL 16 |
| redis | 6379 | - | Redis 7 |
| server | 9000 | postgres, redis | NestJS 后端（含前端 dist） |
| web | - | - | 由 server 托管，无需独立容器 |

> 生产环境建议：仅启动 postgres + redis 容器，server 直接 `node apps/server/dist/main` 运行（避免多层容器网络开销）。

## 回滚

```bash
# 1. 停止服务
docker compose down  # 或 kill 进程

# 2. 回滚代码
git checkout <previous-tag>

# 3. 回滚数据库迁移（需手动生成 down SQL）
psql $DATABASE_URL -c "ALTER TABLE ... DROP ..."

# 4. 重启
pnpm db:migrate && NODE_ENV=production node apps/server/dist/main
```
