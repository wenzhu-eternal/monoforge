# 配置规范

## 环境变量管理

- 所有环境变量通过**根目录** `.env` 文件统一管理（`db/index.ts`、`drizzle.config.ts`、`app.module.ts` 均显式加载根目录 `.env`）
- 前端额外变量（`VITE_*`）也在根目录 `.env` 中配置
- 关键变量缺失时服务启动即失败（fail-fast）
- 详见 `.env.example` 作为完整变量清单模板

### 核心环境变量

| 变量 | 说明 | 默认/示例 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://monoforge_user:monoforge_password@localhost:5434/monoforge_database` |
| `REDIS_URL` | Redis 连接串 | `redis://localhost:6381` |
| `JWT_SECRET` | JWT access token 密钥 | 必填，长度 >= 32 |
| `JWT_REFRESH_SECRET` | JWT refresh token 密钥 | 必填，长度 >= 32 |
| `API_PORT` | 后端端口 | `9000` |
| `API_PREFIX` | API 前缀 | `/api/v1` |
| `ALLOW_ORIGIN` | CORS 白名单 | `http://localhost:3000` |
| `NODE_ENV` | 环境 | `development` / `production` |

### 邮件服务变量

| 变量 | 说明 | 示例 |
|---|---|---|
| `MAIL_HOST` | SMTP 主机 | `smtp.163.com` |
| `MAIL_PORT` | SMTP 端口 | `465` |
| `MAIL_USER` | SMTP 用户名 | `travel_car@163.com` |
| `MAIL_PASSWORD` | SMTP 授权码（非登录密码） | `SKECLRLSATENJTZH` |
| `MAIL_FROM` | 发件人地址 | `travel_car@163.com` |

> 注意：本项目用 `MAIL_PASSWORD`（不是 `MAIL_PASS`）。跨项目拷贝 `.env` 时注意对齐变量名。

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

### 前端 `@shared` alias split-brain

`vite.config.ts` 的 alias 指向 `packages/shared/src`（源码，热更新即时生效），`tsconfig.json` 的 paths 指向 `packages/shared/dist`（编译产物，类型检查用）。两者不一致的根因是 TS 的 `rootDir` 规则：web 的 `rootDir` 限制为 `apps/web/src`，若 paths 指向 `packages/shared/src` 会报 `TS6059`（文件不在 rootDir 内）。统一到源码需要改用 TS project references，改动较大暂未实施。

**缓解措施**：
- `turbo.json` 的 `build`/`lint`/`test` 均配置 `dependsOn: ["^build"]`，确保 `shared` 先于 `web`/`server` 构建到 dist
- 开发时改 shared schema 后需手动执行 `pnpm --filter=shared build` 刷新 dist，否则 `tsc` 类型检查会用旧产物（vite 打包不受影响，因 alias 指向源码）

## 前端环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `VITE_API_BASE_URL` | API 基础地址（同源留空，分离部署配完整 URL） | `''` |
| `VITE_APP_NAME` | 品牌名（侧边栏 Logo、页面标题） | `MonoForge` |
| `VITE_APP_SHORT_NAME` | 品牌简称（侧边栏折叠态显示） | `M` |

### 品牌配置

- 品牌名统一由 `apps/web/src/config/brand.ts` 管理，禁止在组件中硬编码
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

## ngrok 部署

ngrok 部署的完整流程、关键约束和验证步骤详见 [DEPLOYMENT.md](./DEPLOYMENT.md) 的「ngrok 临时外网部署」章节。

**核心要点**：隧道必须绑定 `127.0.0.1:9000`（后端 ServeStaticModule 端口），不能绑 3000（前端 vite dev server）。
