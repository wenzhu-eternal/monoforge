# 配置规范

## 环境变量管理

- 所有环境变量通过**根目录** `.env` 文件统一管理（`db/index.ts`、`drizzle.config.ts`、`app.module.ts` 均显式加载根目录 `.env`）
- 前端额外变量（`VITE_*`）也在根目录 `.env` 中配置
- 关键变量缺失时服务启动即失败（fail-fast）
- 详见 `.env.example` 作为完整变量清单模板

### 核心环境变量

| 变量 | 说明 | 默认/示例 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（DEV） | `postgresql://monoforge_user:monoforge_password@localhost:5432/monoforge_database` |
| `E2E_DATABASE_URL` | e2e 专用 PostgreSQL 连接串（独立容器，DEV DB 零污染） | `postgresql://e2e_user:e2e_password@localhost:5433/monoforge_e2e_db` |
| `E2E_POSTGRES_USER` | e2e-postgres 容器用户名 | `e2e_user` |
| `E2E_POSTGRES_PASSWORD` | e2e-postgres 容器密码 | `e2e_password` |
| `E2E_POSTGRES_DB` | e2e-postgres 容器库名 | `monoforge_e2e_db` |
| `REDIS_URL` | Redis 连接串（含密码：`redis://:password@host:port`） | `redis://localhost:6379` |
| `REDIS_PASSWORD` | Redis 密码（docker-compose 强制必填；代码通过 REDIS_URL 消费，此项供文档/部署参考） | `your_redis_password` |
| `JWT_SECRET` | JWT access token 密钥 | 必填，长度 >= 32 |
| `JWT_REFRESH_SECRET` | JWT refresh token 密钥 | 必填，长度 >= 32 |
| `API_PORT` | 后端端口 | `9000` |
| `TRUST_PROXY` | 反向代理信任（Express trust proxy）：`false` 不信任（本地直跑，防 XFF 伪造绕过 IP 限流）；`1` 信任一层代理（nginx/ngrok 前置时取真实客户端 IP） | `false` |
| `APP_NAME` | 应用名（Swagger 标题、邮件主题、邮件模板均引用，新项目通过 .env 配置） | `MonoForge` |
| `ALLOW_ORIGIN` | CORS 白名单 | `http://localhost:3000` |
| `NODE_ENV` | 环境 | `development` / `production` |
| `COOKIE_SECURE` | refresh token cookie 的 secure 标志（HTTP=false，HTTPS=true） | `false` |
| `ALLOW_INSECURE_COOKIE` | 生产环境允许非 secure cookie（ngrok/单容器 HTTP 调试场景；生产强制 COOKIE_SECURE 除非此项为 true） | `false` |
| `ALLOW_SETUP` | 首次部署初始化开关（true 时允许调用 /setup 接口创建管理员，初始化后建议设为 false） | `false` |
| `ADMIN_ROLE_ID` | admin 角色 ID（PermissionsGuard 超级管理员旁路判定用，seed 创建的 admin 默认 id=1） | `1` |
| `ENABLE_BACKUP` | 定时数据库备份开关：`true` 启用每日 0 点备份，`false` 关闭（开发默认关闭，避免容器未运行导致失败邮件；手动触发 `POST /schedule/backup` 不受此限制） | `false` |
| `BACKUP_CMD` | 自定义备份命令（本机无 `pg_dump` 时可用 `docker exec` 调用容器内命令；命令中 `{filepath}` 占位符会被替换为实际备份文件路径，需做 shell 单引号转义防注入） | - |
| `THROTTLE_TTL` | 限流时间窗口（秒） | `60` |
| `THROTTLE_LIMIT` | 时间窗口内最大请求数（生产 10；e2e 由 `playwright.config.ts` 的 webServer.env 覆盖为 1000） | `10` |
| `SEED_ADMIN_EMAIL` | seed 创建 admin 的邮箱（可选，默认 `admin@example.com`） | `admin@example.com` |
| `SEED_ADMIN_PASSWORD` | seed 创建 admin 的密码（可选，默认 `888888`）。**未显式设置时首登强制改密**（`mustChangePassword=true`）；显式设置则视为运维知情，不强制 | `888888` |
| `SEED_ADMIN_NICKNAME` | seed 创建 admin 的昵称（可选，默认 `Administrator`） | `Administrator` |
| `SEED_ADMIN_MUST_CHANGE_PASSWORD` | 首登强制改密开关（可选）。不设时按密码推断（默认密码强制、自定义密码不强制）；显式 `false` 跳过改密流程（仅本地开发，生产勿关）；显式 `true` 强制 | 未设置 |

> **Docker 部署提醒**：新增后端环境变量时，除在 `env.ts` 声明外，还须在 `docker-compose.yml` 的 `app.environment` 中显式透传，否则容器内读不到该变量（根 `.env` 仅对本地直跑生效）。

### 邮件服务变量

| 变量 | 说明 | 示例 |
|---|---|---|
| `MAIL_HOST` | SMTP 主机 | `smtp.example.com` |
| `MAIL_PORT` | SMTP 端口 | `465` |
| `MAIL_USER` | SMTP 用户名 | `your-email@example.com` |
| `MAIL_PASSWORD` | SMTP 授权码（非登录密码） | `your-smtp-auth-code` |
| `MAIL_FROM` | 发件人地址 | `your-email@example.com` |

> 注意：本项目用 `MAIL_PASSWORD`（不是 `MAIL_PASS`）。

## 配置陷阱

### `ConfigService.get<T>()` 类型陷阱

TypeScript 泛型只是编译期断言，运行时返回值类型由 `.env` 文件内容决定，**所有值都是 string**。数字类型必须 `Number()` 强转：

```ts
const portRaw = this.configService.get<number>('MAIL_PORT') // 运行时仍是 string
const port = portRaw ? Number(portRaw) : 587
```

典型踩坑：`MAIL_PORT=465` 直接传给 `nodemailer.createTransport({ port })` 会因类型不符静默失败或报错。

### Cookie `secure` flag

必须由环境变量控制，不能硬编码。开发环境（HTTP）必须设为 `false`，生产环境（HTTPS）必须设为 `true`。

### 前端 `@shared` alias 统一指向源码

`vite.config.ts` 的 alias 与 `apps/web/tsconfig.json` 的 paths 均指向 `packages/shared/src`（源码）：vite 热更新即时生效，`tsc --noEmit` 类型检查也直接用源码，改 shared schema 后无需重建 dist。

注意：web tsconfig 必须显式设 `"rootDir": "../.."`（仓库根）——否则 TS 自动推断 rootDir 为 `apps/web`，对 paths 解析进来的 `packages/shared/src` 文件报 `TS6059`。web 构建产物由 vite 生成，tsc 仅做类型检查，rootDir 指向仓库根不影响任何输出。

**dist 仍需存在的场景**（`node_modules` 内 `@monoforge/shared` 包引用方，如 server 运行时）：
- `turbo.json` 的 `build`/`lint`/`test` 均配置 `dependsOn: ["^build"]`，确保 `shared` 先于 `web`/`server` 构建到 dist
- 根 `package.json` 的 `prepare` 脚本为 `husky && pnpm --filter=@monoforge/shared build`，`pnpm install` 后自动构建 shared 出 dist，根治 fresh clone 后 server 直接 `node dist/main.js` 找不到依赖的问题

> 注：`dist/` 在 `.gitignore` 中被忽略，不入库。`prepare` 脚本 + turbo 任务图双重保证 dist 总是存在。

## 前端环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `VITE_API_BASE_URL` | API 基础地址（同源留空，分离部署配完整 URL） | `''` |
| `VITE_APP_NAME` | 品牌名（侧边栏 Logo、页面标题） | `MonoForge` |
| `VITE_APP_SHORT_NAME` | 品牌简称（侧边栏折叠态显示） | `MF` |
| `VITE_DEV_HOST` | Vite dev server 绑定主机（默认 `localhost`，局域网调试可设 `0.0.0.0`） | `localhost` |
| `VITE_ENABLE_MOCK` | 启用 MSW mock（开发阶段无后端时使用，生产禁用） | `false` |

### 品牌配置

- 品牌名统一由 `apps/web/src/config/brand.ts` 管理，禁止在组件中硬编码
- `brand.ts` 通过 `apps/web/src/lib/env.ts` 的 `env` 对象读取 `VITE_APP_NAME` / `VITE_APP_SHORT_NAME` / `VITE_ENABLE_MOCK`，不直接读 `import.meta.env`（统一经 zod schema 校验）
- 新项目接入时修改 `.env` 的 `VITE_APP_NAME` / `VITE_APP_SHORT_NAME` 即可
- `index.html` 的 `<title>` 使用 `%VITE_APP_NAME%` 由 Vite 注入

### drizzle-kit 环境变量

- `drizzle.config.ts` 已显式加载根目录 `.env`（`config({ path: '../../.env' })`）
- 在 `apps/server/` 下运行 `drizzle-kit generate` / `drizzle-kit migrate` 时无需手动指定 `.env` 路径

## 邮件服务规范

### 验证码必须后端生成

禁止前端传 `code` 字段，后端用 `node:crypto.randomUUID` 生成 6 位验证码：

```ts
import { randomInt } from 'node:crypto'
const code = randomInt(0, 999999).toString().padStart(6, '0')
```

### Schema 约束

`SendVerificationCodeMailSchema` 只保留 `to`（必填）+ `name`（可选），删除 `code` 字段：

```ts
export const SendVerificationCodeMailSchema = z.object({
  to: z.string().email('请输入有效邮箱'),
  name: z.string().min(1).max(50).optional(),
})
```

### 错误处理

- `mail.service` 的 `send`/`sendHtml` catch 必须 `throw new Error(...)`，不能吞错
- `loadTemplates` 的 catch 同样必须抛错（fail-fast），模板缺失属严重配置错误，不能静默降级
- 让上层 controller 处理响应和 toast

### 邮件模板路径

- 模板文件位于 `apps/server/src/templates/email/*.hbs`（Handlebars）
- `mail.service` 用 `__dirname` 定位模板目录，dev/prod 统一为 `../../templates/email/`：
  - dev：`src/modules/mail/` → `src/templates/email/`
  - prod：`dist/modules/mail/` → `dist/templates/email/`（由 `nest-cli.json` 的 `assets` 配置复制）
- `nest-cli.json` 必须配置 `assets: [{ "include": "templates/email/*.hbs", "outDir": "dist" }]`，否则生产构建后模板丢失
- `__dirname` 方式不依赖 `process.cwd()`，Docker / PM2 任意 WORKDIR 均可正确加载

### 端口强转

`MAIL_PORT` 必须用 `Number()` 强转，详见「配置陷阱」章节。

## Docker 构建变量

| 变量 | 说明 | 示例 |
|---|---|---|
| `BUILD_HTTP_PROXY` | 构建 Docker 镜像时的 HTTP 代理（仅 `docker build` 时需要，不影响运行时） | `http://host.docker.internal:7897` |

> 仅在构建镜像需要代理访问外网时配置，留空则直连。传递给 `--build-arg HTTP_PROXY=...`。

## ngrok 部署

ngrok 部署的完整流程、关键约束和验证步骤详见 [DEPLOYMENT.md](./DEPLOYMENT.md) 的「ngrok 临时外网部署」章节。

**核心要点**：隧道必须绑定 `127.0.0.1:9000`（后端 ServeStaticModule 端口），不能绑 3000（前端 vite dev server）。
