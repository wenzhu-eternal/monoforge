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

# 3. （可选）填充种子数据（幂等：已存在 admin 角色用户时只补齐权限/角色/绑定，不创建也不覆盖 admin）
pnpm db:seed

# 4. 启动后端（同时托管前端 + 提供 API）
NODE_ENV=production node apps/server/dist/main
```

### ngrok 临时外网部署

```bash
# 1. 构建前端产物（后端托管）
pnpm --filter=@monoforge/web build

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
# 期望：{"code":200,"message":"ok","data":{"status":"ok","database":"ok","redis":"ok"}}

# 3. Swagger 文档（仅非生产环境）
curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/api/docs
# 期望：200（生产环境应为 404）
```

## 初始化纪律（L21）

- 初始化（`ALLOW_SETUP=true` + POST /setup，或 `pnpm db:seed`）必须在受控网络（本机/内网/VPN）内完成；未初始化窗口内 `/setup` 先到先得，暴露公网等于把管理员账号送给第一个访问者
- 初始化完成后立即把 `ALLOW_SETUP` 改回 `false`（未开启时 POST /setup 返回 404），并确认配置已生效
- 不要用 `.env.example` 的示例值上线；JWT 密钥用 `openssl rand -base64 48` 生成
- 变更顺序：先 `pnpm db:backup` → 再 `pnpm db:migrate` → 最后启动并验证 `/api/v1/health`

## 生产环境检查清单

部署前必查：

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` / `JWT_REFRESH_SECRET` 已设置为强随机字符串（>= 32 字符）
- [ ] `ALLOW_ORIGIN` 已设为生产域名（非 `*`）；**生产未配置会启动失败**（L15② 强检，杜绝静默收缩到 localhost）
- [ ] `TRUST_PROXY` 已按部署形态设置（直连 false / 一层代理 1 / IP·CIDR 列表）；非法值启动失败，生产未信任任何代理会启动告警（M3）。**反代部署漏配 1 时，全局限流与登录失败锁定会退化为共享代理 IP 的同一桶**
- [ ] `ALLOW_THROTTLE_BYPASS=false`（生产/预发严禁开启；该开关只允许测试环境显式打开，L15①）
- [ ] Cookie `secure` flag 已通过环境变量开启
- [ ] Swagger 已关闭（`NODE_ENV=production` 时自动隐藏）
- [ ] `ALLOW_SETUP=false`（初始化入口已关闭，防止重复初始化覆盖 admin；未开启时 POST /setup 返回 404）
- [ ] `SEED_ADMIN_MUST_CHANGE_PASSWORD=true`（生产强制改密，勿用种子密码长期运行）
- [ ] `ALLOW_INSECURE_COOKIE=false`（HTTPS 生产必须，HTTP 调试才显式放开）
- [ ] 如自定义 `UPLOAD_DIR`/`BACKUP_DIR`：已建目录并挂载持久卷（默认 `<cwd>/uploads`、`<cwd>/backups`）
- [ ] 数据库备份已创建（`pnpm db:backup` 或 `POST /schedule/backup`）
- [ ] 迁移已执行（`pnpm db:migrate`；生产容器启动时自动跑 `dist/db/migrate.js`）
- [ ] 备份链路可用：生产镜像已内置 `postgresql16-client`，默认 pg_dump 路径开箱即用；如配 `BACKUP_CMD` 走 `docker exec`，需确认后端运行位置能访问 docker 命令（仅宿主机直跑有效，app 容器内无效）
- [ ] 邮件/微信未配置时的降级符合预期（mail 未配返回失败、微信未配 503，均不应 500）
- [ ] `pnpm test` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm security` 通过（详见 [TESTING.md](./TESTING.md)）

## Docker 部署

```bash
# 启动所有服务（postgres + redis + server + web）
docker compose up -d

# 查看日志
docker compose logs -f app

# 停止
docker compose down
```

### Dockerfile 多阶段构建

| 阶段 | 内容 |
|---|---|
| `prod-deps` | 仅安装 server(+shared) 生产依赖（`--prod --ignore-scripts`），devDeps 不进镜像 |
| `builder` | 全量安装依赖，依次编译 shared → server → web |
| `runner` | tini 作 PID 1，复制三层 node_modules + dist 产物 + drizzle 迁移文件 |

关键点：

- **三层 node_modules 缺一不可**：pnpm isolated 布局下 server/shared 的直接依赖是各自 node_modules 内指向根 `.pnpm` store 的符号链接，只复制根层会 `MODULE_NOT_FOUND`
- **启动即迁移**：容器 CMD 为 `node apps/server/dist/db/migrate.js && node apps/server/dist/main.js`——先跑迁移再启动服务；migrate 基于 drizzle-orm migrator（运行时依赖），drizzle-kit 属 devDep 不在镜像内
- `uploads/`、`uploads-trash/`、`backups/` 目录构建时创建并 chown 给 `node` 用户（uploads-trash 挂卷持久化软删文件）
- 以非 root `node` 用户运行，tini 负责信号转发与僵尸进程回收

### docker-compose 服务编排

| 服务 | 端口 | 依赖 | 说明 |
|---|---|---|---|
| postgres | 5432 | - | PostgreSQL 16 |
| redis | 6379 | - | Redis 7 |
| app | 9000 | postgres, redis | NestJS 后端（含前端 dist，单一入口） |
| e2e-postgres | 5433 | - | e2e 专用 PostgreSQL 16（profile 隔离，DEV DB 零污染） |

> 生产环境建议：仅启动 postgres + redis 容器，server 直接 `node apps/server/dist/main` 运行（避免多层容器网络开销）。

### 反向代理信任

后端前置 nginx/ngrok 等 proxy 时，必须设 `TRUST_PROXY=1`（信任一层代理），否则 Express 取到的是代理 IP，XFF 伪造可绕过基于 IP 的限流；**且登录失败锁定键（`login:fail:<ip>:<username>`）会把全体来源并成同一 IP，退化为按用户名全局锁死——任意攻击者可零成本锁死 admin（L6/J3）**。本地直跑必须保持 `false`（详见 [CONFIGURATION.md](./CONFIGURATION.md)）。`TRUST_PROXY` 支持 `true`/`false`/代理层数/`loopback`·`linklocal`·`uniquelocal`/IP·CIDR 列表，非法值启动即失败（M3）；生产未信任任何代理会输出启动告警，便于 ngrok/nginx 场景早发现。

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
