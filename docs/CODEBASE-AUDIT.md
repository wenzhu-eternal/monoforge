# 全项目代码审计报告

> 版本：v2（经复检-核验-复检循环收敛：3 轮复检，轮1修正 4 处误报/作废，轮2/轮3 连续零新增真不一致 → 收敛）
> 审计基线：HEAD `ddee04c`（v2 分层软删除全量实现）
> 审计范围：apps/server（后端，逐文件）、apps/web（前端）、packages/shared + 工程化/迁移
> 已知并已在 [[monoforge-softdelete-whitelist-gap]] 记录的白名单缺口不再列入本报告正文，仅在 S1 占位汇总。

## 复检修正记录
- 轮1：M17 删 users 误报（users.tsx:138 禁用按钮已正确 disabled）；M22「连上即断」作废（ws.ts:44 已监听 on('pong') clearTimeout，链路闭合）降级为🟢；M16 修正为非漏洞（后端 role-permissions.service 已用 inArray 过滤不存在 code）；轻微项「FileItemSchema updatedAt」作废删除（files schema 确无 updatedAt 列，schema 正确）。
- 轮2/轮3：S6/M3/M1/M8/M27/M11/M4/M2 逐条核验均成立，零新增。

本报告按「严重 / 中等 / 轻微」分级，每条含 `[文件:行]` + 复现影响 + 修复建议。文末附「修复批次拆分」供实施 agent 照做。

---

## 一、🔴 严重（功能 bug / 安全漏洞，必须修）

### S1. error_whitelist 管理员可见性缺失（已记录，此处仅占位汇总）
- 详见 [[monoforge-softdelete-whitelist-gap]]：`error-logs.service.ts:316-337` `findWhitelist()` 无 `includeDeleted` 入参；`error-logs.controller.ts:117-119` 未传。管理员看不到已软删白名单规则，前端删除状态列恒显「正常」、恢复按钮恒禁用，`POST /whitelist/:id/restore` 形同虚设。
- 连带：`WHITELIST_CACHE_KEY` 被 `checkWhitelist` 与 `findWhitelist` 共用，修复时须让 admin 查询直查 DB 且不回写该 cache，否则已删规则继续压制错误上报。
- 连带既存 bug：`matchWhitelist`（`error-logs.service.ts:300-314`）只读 `pattern/matchType`，忽略 `isActive`，停用规则在缓存预热窗口内仍生效。

### S2. HttpClient 无限重试风险（待核 axios 拦截器再入行为）
- **[apps/server/src/modules/http-client/http-client.service.ts:64-71,105]**
- 现象：request 拦截器每次执行都把 `__retryCount` 重置为 0；response 拦截器重试时调用 `instance.request(config)`，axios 对重发的 request 会**再次执行 request 拦截器** → `__retryCount` 被再次归零 → `__retryCount < __maxRetries` 永真 → 可能无限重试（每次 5xx 都重试到天荒地老，或直到对端恢复）。
- 影响：外部服务（微信 OAuth、支付等）5xx 时形成重试风暴，可能拖垮自身与对端；指数退避虽增长延迟但重试次数无上限。
- 复现：微信接口临时 500 → 客户端无限重试，日志刷屏，连接堆积。
- 建议：将重试计数挂在 `config` 上但**不在 request 拦截器里重置**，只在 `createInstance` 初始化时设默认 `__maxRetries`，response 拦截器内 `++__retryCount` 不再被覆盖；或改用 axios-retry / 独立变量。**待核**：axios 对 `instance.request(config)` 是否再触发 request 拦截器（需跑一次最小复现确认，若不复现则降级为 🟡）。

### S3. WebSocket 开发态可冒充任意用户
- **[apps/server/src/modules/websocket/events.gateway.ts:142-148]**
- 现象：`extractUserId` 在 `NODE_ENV !== 'production'` 时接受 `client.handshake.query.userId` 作为用户身份，无任何鉴权。
- 影响：开发/预发环境（或误以 development 配置部署）下，任何未认证用户传 `?userId=1` 即可冒充 admin 连接 WS，接收该用户的实时通知、触发 presence 广播。
- 复现：`NODE_ENV=development` 部署 → 攻击者 `io('?userId=1')` → 以 admin 身份上线，收到所有推送给 admin 的通知。
- 建议：移除 `query.userId` 降级分支，或加 `ALLOW_WS_QUERY_AUTH` 开关且默认关闭，仅本地调试显式开启。

### S4. WebSocket CORS 允许任意 origin 携带凭据
- **[apps/server/src/modules/websocket/events.gateway.ts:19-23]**
- 现象：`@WebSocketGateway({ cors: { origin: true, credentials: true } })`，允许任意 origin 携带 cookie 建立 WS。socket.io 不受 `main.ts` 的 HTTP CORS 策略约束。
- 影响：跨站 WebSocket 劫持（CSWSH）——恶意页面可凭受害者浏览器中的 refresh cookie 建立已认证 WS 连接，接收其通知/在线状态。
- 建议：`origin` 收敛为与 HTTP 一致的 `ALLOW_ORIGIN` 白名单（从 ConfigService 读取），`credentials: true` 保留。

### S5. access token 存 localStorage（XSS 可窃取）
- **[apps/web/src/store/auth-store.ts:15-31]**（配合 `apps/web/src/lib/api.ts:33-35`）
- 现象：zustand `persist({ name: 'auth-storage' })` 默认用 localStorage，`token`（access token）被持久化。refresh token 已在 httpOnly cookie（正确），但 access token 仍在 localStorage。
- 影响：任意同源 XSS 即可读取 localStorage 拿走 access token（15m 有效），冒充用户发请求。
- 复现：任一依赖库 XSS 或 `dangerouslySetInnerHTML` 漏洞 → `localStorage.getItem('auth-storage')` → 拿到 token。
- 建议：`token` 不 persist（仅 persist `user`），access token 改放内存变量或 sessionStorage；或 access token 也走 httpOnly cookie（需后端从 cookie 读 access，改动较大，二选一）。

### S6. ServeStatic 挂载 /uploads 无鉴权，可枚举/直取他人文件
- **[apps/server/src/app.module.ts:44-48]**
- 现象：`ServeStaticModule` 把 `uploads` 目录挂到 `/uploads`，`serveStaticOptions: { index: false }` 仅阻止目录索引，不阻止文件直取。上传文件名虽含时间戳+随机，但 `generateSafeFilename` 用 `Math.random()`（`file-validator.ts:192`，非密码学随机），可枚举。
- 影响：任何未登录用户只要猜中/泄露文件名即可直取 `/uploads/xxx.png`，绕过 `files.preview` 的鉴权与软删 404 逻辑——**软删文件磁盘若未移走仍可被静态托管访问**（但 `files.service.remove` 会 `rename` 到 trash，已删文件不在 uploads 内，此点已防护 ✅）；主要风险是**正常文件对未认证用户可直取**。
- 复现：登录用户预览文件 → 拿到 `/uploads/timestamp-random-name.png` → 退出登录 → 直接访问该 URL 仍可下载。
- 建议：取消 `/uploads` 静态托管，所有文件访问统一走 `files.preview/download`（已有鉴权）；或对 `/uploads/*` 加鉴权中间件。**注**：当前 `files.preview` 已从 DB `file.path` 流式返回，不依赖静态托管，取消静态托管对预览无影响。

### S7. SetupController 初始化接口无任何访问限制
- **[apps/server/src/modules/setup/setup.controller.ts:11-28]**
- 现象：整个 `SetupController` `@Public()`，`POST /setup` 仅靠 service 内 `initialized` 检查防重复。在系统未初始化的窗口期，任何公网未认证用户都能调用创建 admin。
- 影响：部署后若运维未第一时间初始化，攻击者可抢注 admin 账号接管系统。
- 复现：新部署实例未初始化 → 攻击者 `POST /api/v1/setup` 抢先创建 `username=admin` → 运维随后发现已「已初始化」无法重置。
- 建议：加环境开关 `ALLOW_SETUP=true`（默认 false，仅首次部署显式打开），或限制源 IP，或初始化后物理禁用该路由。最低限度：初始化成功后该路由返回 404。

### S8. isPathSafe 路径穿越校验不充分
- **[apps/server/src/common/file-validator.ts:178-182]**
- 现象：`isPathSafe` 用 `normalizedPath.replace(/\.\.\//g, '').startsWith(normalizedBase)`，仅做字符串前缀匹配，未用 `path.resolve` 规范化后比较。`replace(/\.\.\//g,'')` 只删 `../`，对 `..` 无斜杠变体、URL 编码、符号链接无效。
- 影响：理论上可构造路径绕过前缀校验读取 baseDir 外文件。**当前实际风险较低**：`files.upload` 的 `file.path` 来自 multer `dest: UPLOAD_DIR`，multer 生成的 path 必在 UPLOAD_DIR 内；但若未来有路径写入来自用户输入，此函数会失守。
- 建议：改用 `path.resolve(filePath).startsWith(path.resolve(baseDir) + path.sep)` 做规范化比较，或用 `path.relative` 判断不含 `..`。

### S9. XssPipe 在 Zod 校验后改写 body，可能破坏不变量并影响白名单匹配
- **[apps/server/src/main.ts:57]** + **[apps/server/src/common/pipes/xss.pipe.ts:14-22]**
- 现象：全局管道顺序 `SanitizeBodyPipe → ZodValidationPipe → XssPipe`，XSS 清洗在 Zod 校验**之后**运行，且 `xss(value, { whiteList: {}, stripIgnoreTag: true })` 会改写字符串（strip 所有标签）。Zod 保证的不变量（长度、枚举值）在 XSS 改写后可能不再成立，入库值与校验值不一致。
- 影响：`error-logs/report` 的 `message` 经 XssPipe 清洗后入库，若用户上报的错误消息含 `<` 字符，清洗后串变化，**白名单 pattern 匹配的是清洗后的串**，可能漏匹配；其他含合法 `<` 的字段（如富文本）也会被破坏。
- 复现：前端上报 `message: " Unexpected <token> "` → XssPipe strip → 入库为 `" Unexpected token "`（去括号）→ 白名单 pattern `<token>` 不再命中。
- 建议：XSS 清洗移到 Zod 之前（对原始输入清洗），或在 Zod schema 内用 `.transform()` 统一清洗，保证「校验过的值 == 入库值」。
---

## 二、🟡 中等（逻辑缺陷 / 明显优化）

### M1. files.download 无所有权校验（同类越权，方案只点名 preview）
- **[apps/server/src/modules/files/files.controller.ts:132-146]**
- 现象：`download` 仅 `@Permissions(FILE_VIEW)`，调用 `findById(id)` 后直接流式返回，不校验「管理员或上传者本人」。preview 已修（`3.4`），download 未修。
- 影响：任何有 `FILE_VIEW` 权限的用户可下载他人上传的文件。
- 建议：download 复用 preview 的鉴权逻辑（`findByIdRaw` + admin/uploader 校验 + 软删 404）。

### M2. AuthGuard 不校验 access token 吊销状态
- **[apps/server/src/modules/auth/auth.guard.ts:45-51]**
- 现象：`AuthGuard` 仅 `verifyAsync(token)`，不查 Redis 黑名单。logout 仅吊销 refresh token（`auth.service.logout` 删 `refresh:*`），access token 在剩余 15m 内仍有效。
- 影响：logout 后 15m 内 access token 仍可用，无法即时失效。
- 建议：_logout 时把 access token 的 jti 也写入 Redis 黑名单（TTL = 剩余有效期），AuthGuard 内增加黑名单查询；或接受短时效取舍但需在文档标注。**注**：当前 access token 无 jti，需先补 jti（refresh 已有）。属安全增强，可议。

### M3. 微信新建用户不分配角色，登录后无任何权限
- **[apps/server/src/modules/wechat/wechat.service.ts:244-253]**
- 现象：`findOrCreateUser` 创建微信用户时未设 `roleId`。
- 影响：微信用户登录后 `hasPermission` 返回 false（无 roleId，非 admin），只能访问公开接口，无法进入受保护页面。
- 建议：创建时分配默认 `viewer` 角色（与 setup 的 DEFAULT_ROLES 一致），或文档标注「微信用户需后台手动分配角色」。

### M4. updateRolePermissions 静默丢弃软删权限码
- **[apps/server/src/modules/permissions/role-permissions.service.ts:64-72]**
- 现象：`updateRolePermissions` 过滤掉指向已软删权限的 code，不告知前端。
- 影响：前端传了 5 个 code，实际只分配 3 个，前端无感知，误以为已分配。
- 建议：返回被过滤的 code 列表 `{ message, skipped: string[] }`，或抛 400 让前端感知。

### M5. 健康检查向未认证用户暴露内部组件状态
- **[apps/server/src/modules/health/health.controller.ts:19-26]** + **[health.service.ts:23-53]**
- 现象：`@Public()` 健康检查返回 `{ database, redis }` 的 ok/error 详情。
- 影响：攻击者可探测 DB/Redis 是否在线，辅助定向攻击。
- 建议：未认证时只返回 `{ status: 'ok'|'error' }` 不带组件细节；详情仅认证后返回，或仅内部探针用。

### M6. 限流全局共享，登录/注册/发码接口无单独限流
- **[apps/server/src/app.module.ts:50-61]** + **[apps/server/src/modules/auth/auth.controller.ts:34-60]**
- 现象：全局限流 60s/10 次，`login`/`register`/`send-register-code` 共用配额。`env.ts:39` 注释自述「登录接口建议单独更严格限流」但未实施。
- 影响：登录 brute-force 换 IP 即绕过；正常重试易耗尽配额影响其他接口。
- 建议：这几个路由加 `@Throttle({ default: { limit: 5, ttl: 60_000 } })`，并按 IP+email 维度加失败计数。

### M7. CORS 回调 console.warn 用户可控 Origin（日志注入）
- **[apps/server/src/main.ts:49]**
- 现象：`console.warn(\`[CORS] blocked origin: ${origin}\`)`，origin 来自请求头，含 `\n\r` 可伪造日志行。
- 建议：过滤 origin 的 `\n\r`，或改用结构化 logger。

### M8. mailSEND 失败 / 模板缺失导致启动崩溃
- **[apps/server/src/modules/mail/mail.service.ts:44-62]**
- 现象：`loadTemplates` 在 constructor 同步执行，任一模板（welcome/verification/backup）缺失即抛错，`MailService` 在模块初始化时实例化 → 整个 app 启动失败。
- 影响：生产误删一个模板文件即无法启动；改动模板需重启。
- 建议：模板加载失败改为 warn 降级（缺模板时用 plain text fallback，`sendWelcome` 已有 fallback 分支），不阻塞启动。

### M9. nodemailer 未强制 TLS
- **[apps/server/src/modules/mail/mail.service.ts:30-35]**
- 现象：`secure: port === 465`，非 465 端口 `secure:false` 且未设 `requireTLS`。若 SMTP 服务器支持 STARTTLS 但默认不升级，认证可能明文传输。
- 建议：加 `requireTLS: port !== 465`（或统一显式 `secure:true` 用 465）。

### M10. scanForMalware 读文件异常静默放行
- **[apps/server/src/common/file-validator.ts:155-173]**
- 现象：`scanForMalware` catch 块「读文件失败不阻塞（二进制文件无法 toString）」——`handle.read` 因权限/异常失败时也静默放行，恶意文件可在读取异常时绕过扫描。
- 建议：区分「二进制 toString 无效」（正常）与「读取异常」（应拒），后者抛 BadRequestException。

### M11. validateFileContent magic number 仅覆盖 jpg/png/gif/pdf
- **[apps/server/src/common/file-validator.ts:65-70,133-153]**
- 现象：`MAGIC_NUMBERS` 只 4 种，docx/xlsx/zip 等不校验内容头，可改后缀上传（虽有 MIME + 扩展 + 黑名单多层，但内容层缺失）。
- 建议：补 zip（PK）、docx/xlsx（均 zip 容器 PK 头）等 magic number。

### M12. update 相关 schema PATCH 语义过严（UpdateUserSchema email/roleId 必填）
- **[packages/shared/src/schemas/user.ts:56-64]**
- 现象：`UpdateUserSchema` 把 `email`、`roleId` 设为必填，非 PATCH 语义；同 schema 的 `status`/`password` 又 optional，行为不统一。
- 影响：前端只想改 nickname 也必须传 email+roleId，易触发 400。
- 建议：统一 optional，或拆 `UpdateUserMeSchema` / `UpdateUserAdminSchema`。

### M13. ErrorLogSchema 未复用已定义的 enum
- **[packages/shared/src/schemas/error-log.ts:21,24]** vs **[:3-13]**
- 现象：定义了 `ErrorSource`/`ErrorType` enum，但 `ErrorLogSchema.source` 用 `z.string()`、`errorType` 用 `z.string().nullable().optional()`，未复用。
- 影响：enum 形同虚设，无效值不报错，前后端漂移无人察觉。
- 建议：`source: ErrorSource`、`errorType: ErrorType.nullable().optional()`。

### M14. NotificationSchema.deletedAt 缺 .optional()
- **[packages/shared/src/schemas/notification.ts:11]**
- 现象：`deletedAt: z.coerce.date().nullable()` 未加 `.optional()`，其余 schema 均 `.nullable().optional()`。zod 中 nullable ≠ optional，字段缺失会校验失败。
- 影响：server 在未软删场景不返回该字段时前端 parse 报错（若前端启用 strict parse）。
- 建议：统一 `.nullable().optional()`。

### M15. UserSchema.avatar 用 z.string().url() 拒绝相对路径
- **[packages/shared/src/schemas/user.ts:14]**
- 现象：`avatar: z.string().url()`，但后端文件上传返回相对路径（如 `/uploads/...`）会被 `url()` 拒绝。
- 建议：放宽为 `z.string().nullable().optional()` 或自定义 `urlOrPath`。

### M16. UpdateRolePermissionsSchema 缺防御性权限码约束（优先级低）
- **[packages/shared/src/schemas/permission.ts:28-30]**
- 现象：`permissions: z.array(z.string().min(1)).min(0)`，未限定为 `PermissionCodes` 集合。
- 核验：后端 `role-permissions.service.ts:67-71` 已用 `inArray(permissions.code, permissionCodes)` 过滤，**只保留 DB 中存在的 code**，无效 code 不会写入。故此条仅为 schema 层防御性建议，非实际漏洞。
- 建议（可选）：schema 层 `z.array(z.enum([...PermissionCodes]))` 提前短路，减少后端查询。

### M17. 前端「禁用」按钮在已禁用态未 disabled（roles/permissions/files 可重复 DELETE）
- **[apps/web/src/routes/roles.tsx:179]** + **[apps/web/src/routes/permissions.tsx:162]** + **[apps/web/src/routes/files.tsx:215]** + **[apps/web/src/routes/error-logs.tsx WhitelistTab ~695]**
- 现象：已软删记录的「禁用」按钮仍可点击（仅 Popconfirm title 变「已禁用」文案，但按钮未 `disabled={isDeleted}`），重复发 DELETE/禁用请求。恢复按钮已正确 `disabled={!isDeleted}`，禁用按钮未对称。
- 核验修正：`users.tsx:138` 禁用按钮**已正确** `disabled={isDeleted}`（含初始 admin 不可删提示），**users 不在此列**（初稿误报，已删）。
- 影响：重复打软删请求（虽幂等，但语义混乱、可能触发后端校验报错）。
- 建议：禁用按钮 `disabled={isDeleted}`。

### M18. 重复定义 useRoles（死代码）
- **[apps/web/src/hooks/use-logs.ts:191-201]** vs **[apps/web/src/hooks/use-roles.ts:12-22]**
- 现象：`use-logs.ts` 末尾重复导出 `useRoles`，queryKey 同前缀但参数 shape 不同（`LogQuery` 无 order vs `PaginationQuery` 有 order），同树混用会互相覆盖缓存。
- 建议：删除 `use-logs.ts:191-201`，统一从 `use-roles` 导入。### M19. roles/permissions 编辑表单灌入整对象并整体提交
- **[apps/web/src/routes/roles.tsx:201,226]** + **[apps/web/src/routes/permissions.tsx:184]**
- 现象：`setFieldsValue({...role})` 把 id/createdAt/deletedAt/permissions 全灌入 form store，`handleSubmit` 把 `values as UpdateRole` 整体提交，后端 Zod strict 会 400。
- 建议：只 setFieldsValue/提交 `{ name, description }`（roles）或 `{ code, name, description }`（permissions）。

### M20. 路由权限守卫用 store 旧值，首屏可能误 redirect
- **[apps/web/src/lib/route-guards.ts:21-35]** + **[apps/web/src/layouts/authenticated-layout.tsx]**
- 现象：`requirePermission` 在 `beforeLoad` 用 `useAuthStore.getState().user.permissions` 判断，但首次进入 `useCurrentUser()` 仍在 loading，store 里是 localStorage 旧值，新登录用户首次访问受保护页可能误 redirect /403。
- 建议：beforeLoad 只检登录，权限校验移到 layout 内 `isLoading=false` 后用 `<Navigate to="/403">`。

### M21. useEffect 清理不 disconnect，WebSocket 监听叠加
- **[apps/web/src/hooks/use-websocket.ts:32-56]**
- 现象：`wsClient` 单例 + 多处 `useWebSocket`/`useWebSocketDemo` 挂载，effect 清理只 `off` 监听器不 disconnect，可能叠加 `on('notification')` 回调重复触发。
- 建议：effect 清理中 off 本 effect 注册的全部事件，或显式引用计数。

### M22.（作废，降级为🟢轻微）自定义 ping/pong 与 socket.io 内置心跳叠加
- **[apps/web/src/lib/ws.ts:44-47,92-102]** vs **[apps/server/.../events.gateway.ts:83-86]**
- 核验修正：前端 `ws.ts:44` **已监听 `on('pong')` 并 clearTimeout**，后端 `@SubscribeMessage('ping')` 返回 `{event:'pong'}`，链路闭合 → 心跳正常工作，**不会「连上即断」**。初稿的「连上即断」判断作废。
- 残留轻微项：自定义心跳叠加在 socket.io 内置 `pingInterval/pingTimeout` 之上属冗余，可择一保留，但不影响功能。不单列修复。

### M23. @types/node 25 与运行时 Node 20 不一致
- **[apps/server/package.json / apps/web/package.json]** `@types/node: ^25.3.3`，但 Dockerfile/CI 用 `node:20-alpine`/`node-version: 20`。
- 影响：tsc 通过不代表 Node 20 可用；Node 25 类型可能放行 Node 20 不存在的 API。
- 建议：`@types/node` 收敛 `^20.x`，root `engines.node: ">=20 <21"`，CI 加 `node -v` 校验。

### M24. Dockerfile 未 COPY drizzle，生产不自动迁移
- **[Dockerfile:30-44]** + **[docker-compose.yml]**
- 现象：runtime 只 COPY `apps/server/dist`、`packages/shared/dist`、`apps/web/dist`，未 COPY `apps/server/drizzle`；`CMD ["node","apps/server/dist/main.js"]` 无 `db:migrate` 步骤。
- 影响：生产首次启动/扩容不自动迁移，需外部手动跑，代码依赖最新 schema 会 500。
- 建议：COPY `drizzle/` 进镜像，entrypoint 先 `migrate` 再启动；或单独 migrator one-shot job。

### M25. docker-compose 硬编码 CORS/Cookie 配置
- **[docker-compose.yml:85-86]**
- 现象：`ALLOW_ORIGIN=http://localhost:9000`、`COOKIE_SECURE=false` 直接硬编码，未走 `${VAR:-default}`。
- 影响：部署非 localhost 域时 CORS 拒绝、Cookie 不下发。
- 建议：改 `${ALLOW_ORIGIN:-http://localhost:9000}`、`${COOKIE_SECURE:-false}`，`.env.example` 给 prod 取值说明。

### M26. CI typecheck 漏跑 shared 与 e2e filter 失效
- **[.github/workflows/ci.yml:34]**（shared 无 typecheck job）+ **[:?]** `@monoforge/e2e` filter 指向不存在的包
- 现象：CI typecheck 跑 server/web，漏 shared 的 `tsc --noEmit`；`@monoforge/e2e` filter 在 `pnpm-workspace.yaml` 里不存在，静默 noop。
- 影响：shared 的 zod 类型错误 CI 不能早发现；e2e typecheck 实际未跑。
- 建议：CI 加 `pnpm --filter=@monoforge/shared exec tsc --noEmit`；root 加 `"typecheck": "turbo typecheck"` + turbo.json 声明；移除/修正 e2e filter。

### M27. updatedAt 仅 INSERT 生效，UPDATE 不刷新
- **[apps/server/src/db/schema/*.ts]** 所有表 `updatedAt: timestamp('updated_at').defaultNow().notNull()`，无 `.$onUpdate(() => new Date())`。
- 影响：`updatedAt` 永远等于 `createdAt`，语义错误。涉及 users/roles/permissions/notifications/error-whitelist。
- 建议：drizzle 加 `.$onUpdate(() => new Date())`，或 DB trigger。

### M28. audit_logs / error_logs 无索引，高写入表性能崩坏
- **[apps/server/src/db/schema/audit-logs.ts:3-14]** + **[apps/server/src/db/schema/error-logs.ts:12-32]**
- 现象：`audit_logs` 对 `userId/action/resource/resourceId/createdAt` 无索引；`error_logs` 对 `userId/errorType/source/isResolved/createdAt/statusCode` 无索引。
- 影响：按用户/资源/时间/未解决筛选全表扫描，高写入场景性能崩坏。
- 建议：`audit_logs` 加 `(userId, createdAt)` + `(resource, resourceId)`；`error_logs` 加 `(isResolved, createdAt)` + `(userId, createdAt)` + `(source, createdAt)`。

### M29. notifications 索引未覆盖高频查询
- **[apps/server/src/db/schema/notifications.ts:27-29]**
- 现象：仅 `(userId, createdAt)` 索引；高频查询 `WHERE user_id=? AND read=false ORDER BY created_at`（`unreadCount`/`list unreadOnly`）未覆盖。
- 建议：改/加 `(userId, read, createdAt)`。

### M30. db 连接池 max:10 硬编码且无 max_lifetime
- **[apps/server/src/db/index.ts:12-16]**
- 现象：`max:10` 硬编码不可配置；有 `idle_timeout:20`/`connect_timeout:10` 但无 `max_lifetime`，长连接遇 DB 侧 wait_timeout 会变 stale。
- 建议：从 env 读 `DB_POOL_MAX`，设 `max_lifetime: 30*60`。

---## 三、🟢 轻微（代码风格 / 小改进，可选）

- **[apps/server/src/main.ts:80-83]** 启动日志用 `console.log` 而非 Logger，与 logger.ts 割裂。
- **[apps/server/src/main.ts:44-54]** CORS `callback(null, false)` 未传 Error（功能正确，NestJS 惯例）。
- **[apps/server/src/db/helpers.ts:22-29]** `isUniqueViolation` 用 `'code' in error` 过宽，建议 `error instanceof postgres.PostgresError`。当前 setup.service.ts 内联重复了同逻辑（:87-92），建议抽到 helpers 复用。
- **[apps/server/src/db/schema/notifications.ts:23]** 列名 `read` 易混，建议 `isRead`。
- **[apps/server/src/db/schema/error-whitelist.ts:6]** `matchType` 注释说仅 `message|url` 但 DB 不约束，建议 `pgEnum`。
- **[apps/server/src/db/schema/audit-logs.ts:6-7]** `action/resource varchar(50)` 偏紧，建议 100。
- **[apps/server/src/db/schema/files.ts:12]** `trashPath` varchar 无 length，与同表风格不一，建议 255。
- **[apps/server/src/db/schema/files.ts:9]** `size` 用 32-bit integer（上限 ~2GB），建议 `bigint`（当前 upload 限制 10MB，实际不溢出，但 schema 留隐患）。
- **[apps/server/src/db/schema/users.ts:25]** `roleId` 未声明 FK `references(() => roles.id)`（应用层已校验，但无 DB 级约束）。`files.ts:11` `uploadedBy` 未指定 `onDelete`。
- **[apps/server/src/db/schema/error-logs.ts:25,30]** `userId`/`resolvedBy` 无 FK。
- **[apps/server/src/db/index.ts:9]** `process.env.DATABASE_URL!` 非空断言，建议 `getEnv().DATABASE_URL` 或显式校验。
- **[apps/server/src/db/index.ts:7]** `config({ path: '../../.env' })` 硬编码相对路径，与 app.module.ts 的 `__dirname` 派生双源，建议从 `config/env.ts` 统一暴露 `envPath`。
- **[apps/server/src/config/env.ts:14,40-41]** `API_PORT/THROTTLE_TTL/THROTTLE_LIMIT` 无 min/max（`THROTTLE_LIMIT=-1` 会通过）。
- **[apps/server/src/config/env.ts:28-32,34-37]** MAIL_*/WEAPP_* 独立 optional，建议成组必填（superRefine）。
- **[apps/server/src/config/env.ts:47-52]** 生产 warning 用 `console.warn`，建议 Logger。
- **[apps/server/src/config/env.ts:59-74]** `validateEnv` `process.exit(1)`，测试不友好，建议抛错。
- **[apps/server/src/common/logger.ts:26]** `appendFileSync` 同步写盘，高并发 5xx 阻塞事件循环，建议异步队列。
- **[apps/server/src/common/file-validator.ts:192]** `generateSafeFilename` 用 `Math.random()`（非密码学随机，配合 S6 可枚举）。
- **[apps/server/src/common/middleware/sanitize.middleware.ts:5-16]** 脱敏字典漏 `cookie`/`wechat`/`openid`/`session`（部分走 header 不经 body，影响有限）。
- **[apps/server/src/modules/audit/audit.service.ts:34]** `findAll` 无筛选（按 user/resource/action/时间），与前端 audit-logs.tsx 一致但体验欠佳。
- **[apps/server/src/modules/auth/auth.guard.ts]** access token 无 jti（refresh 有），支撑 M2 改造前需先补。
- **[packages/shared/src/schemas/pagination.ts:13-18]** `PaginationQuery.order` 类型必填但无对应 zod schema，前后端约束不对齐。
- **[packages/shared/src/schemas/auth.ts:11-15]** `AuthResponseSchema` 用 `UserSchema.extend` 覆盖已有 `roles/permissions`，多余。
- **[packages/shared/src/schemas/setup.ts:14-18]** `userCount/roleCount` 未 `.nonnegative()`，与 dashboard 风格不一。
- **[packages/shared/src/schemas/user.ts:4-7 vs 15-19]** `PhoneSchema` optional vs `UserSchema.phone` nullable，两处正则同但语义不同，建议 `UserSchema.phone = PhoneSchema.nullable()`。
- **[packages/shared/src/constants/errors.ts]** ErrorCodes 缺常见业务码（PERMISSION_DENIED/ROLE_IN_USE/MAIL_SEND_FAILED/FILE_QUARANTINED/SETUP_ALREADY_INITIALIZED 等）。
- **[packages/shared/src/constants/permissions.ts:21]** `USER_ROLE_MANAGE = 'user:role_manage'` 用下划线，与其余 `module:action` 驼峰风格不一，建议 `user:roleManage` 或 `user:role_assign`。
- **[apps/web/src/lib/error.ts:7-17]** 只识别 `string` 型 backendMessage，未处理 Zod message 数组。
- **[apps/web/src/lib/error-reporter.ts:11]** `try{...}catch{}` 静默吞错（注释已说明）。
- **[apps/web/src/components/query-provider.tsx]** 未设 staleTime，所有查询立即 stale。
- **[apps/web/src/routes/users.tsx:385]** 删除按钮文案 `{isDeleted ? '禁用' : '禁用'}` 三元两分支相同，死代码。
- **[biome.json:14,16,18]** `noExplicitAny: warn`、`noNonNullAssertion: off`、`useImportType: off`，lint 强度弱，可逐步收紧。
- **[biome.json:27]** `formatWithErrors: true` 可能掩盖 CI 失败，建议 false。
- **[Dockerfile:42-44]** COPY 整个根 node_modules（含 devDeps），镜像膨胀，建议 `pnpm deploy` 或 `--prod`。
- **[Dockerfile:8-11]** runtime 阶段 sed 改镜像多余（已不装包），且 apk 用 http 明文。

---## 四、📋 与 docs/SOFT-DELETE-PLAN.md 的不一致

除已知白名单缺口（S1）外：

1. **M1 files.download 越权**：方案 3.4 只点名 preview 修鉴权，download 漏修，属同类越权未覆盖。需求侧确认是否纳入。
2. **M17 前端禁用按钮未对称 disabled**：方案 5.1「新增恢复按钮」实现了恢复的 disabled 语义，但禁用按钮未对称，与「已禁用态不应再禁用」的意图不符。
3. **M27 updatedAt 不更新**：方案未提及，但软删 `remove`/`restore` 多处 `set({deletedAt})` 未带 `updatedAt`，若启用 `$onUpdate` 需确认 restore 也刷新 updatedAt。
4. 其余表策略（role_permissions 物理删、audit_logs 不删、notifications 维持软删、error_whitelist A+B 并存）实现与方案一致 ✅。

---

## 五、修复批次拆分（每批 ≤3 文件，供实施 agent 照做）

> 原则：先安全后功能；每批改完跑 `pnpm -F @monoforge/shared build && pnpm --filter server exec tsc --noEmit && pnpm --filter server exec vitest run`。

### 批次 1：error_whitelist 可见性 + 缓存隔离（S1）
1. `apps/server/src/modules/error-logs/error-logs.service.ts` — `findWhitelist(includeDeleted)` 用 `maybeDeleted`；`includeDeleted=true` 时直查 DB 不回写 `WHITELIST_CACHE_KEY`；顺手修 `matchWhitelist` 忽略 `isActive`（M? 连带）。
2. `apps/server/src/modules/error-logs/error-logs.controller.ts` — `findWhitelist` 加 `@CurrentUser` 传 `isAdmin`。
3. `apps/server/src/modules/error-logs/error-logs.service.spec.ts` — 补 admin 可见软删规则 + 不污染匹配缓存断言。

### 批次 2：高优安全（S2 待核 + S3 + S4）
1. `apps/server/src/modules/http-client/http-client.service.ts` — 修重试计数被重置（S2，先跑最小复现确认是否无限重试）。
2. `apps/server/src/modules/websocket/events.gateway.ts` — 移除 `query.userId` 降级（S3）+ WS CORS 收敛白名单（S4）。
3. 相应 spec 调整。

### 批次 3：文件/初始化安全（S6 + S7 + M1）
1. `apps/server/src/app.module.ts` — 取消 `/uploads` 静态托管（S6）。
2. `apps/server/src/modules/files/files.controller.ts` — `download` 加所有权校验（M1）。
3. `apps/server/src/modules/setup/setup.controller.ts` + `setup.service.ts` — 初始化加 `ALLOW_SETUP` 开关（S7）。

### 批次 4：管道顺序 + XSS（S9）
1. `apps/server/src/main.ts` — 调整管道顺序（XSS 移到 Zod 前）或改 schema transform。
2. `apps/server/src/common/pipes/xss.pipe.ts` — 确认是否只读。
3. 受影响 spec。

### 批次 5：前端 token + 守卫（S5 + M20）
1. `apps/web/src/store/auth-store.ts` — token 不 persist（S5）。
2. `apps/web/src/lib/route-guards.ts` + `apps/web/src/layouts/authenticated-layout.tsx` — 权限校验移到 layout（M20）。
3. `apps/web/src/lib/api.ts` — 确认 token 改内存后拦截器仍可用。

### 批次 6：前端按钮 + 表单（M17 + M19 + M18）
1. `apps/web/src/hooks/use-logs.ts` — 删重复 `useRoles`（M18）。
2. `apps/web/src/routes/{roles,permissions}.tsx` — 表单只 setFieldsValue/提交目标字段（M19）；禁用按钮 disabled（M17）。
3. `apps/web/src/routes/{users,files,error-logs}.tsx` — 禁用按钮 disabled（M17）。

### 批次 7：schema 漂移（M12-M16）
1. `packages/shared/src/schemas/{user,error-log,notification,permission}.ts` — enum 复用/optional/URL/PATCH 语义（M12-M15）+ 权限码集合校验（M16）。
2. 重建 shared，修后端因 schema 变严导致的 400（如 roles 编辑接口）。

### 批次 8：工程化（M23-M26）
1. `apps/server/package.json`/`apps/web/package.json` — `@types/node` 收敛 20（M23）。
2. `Dockerfile`/`docker-compose.yml` — COPY drizzle + migrate entrypoint（M24）+ 变量化（M25）。
3. `.github/workflows/ci.yml`/`turbo.json` — shared typecheck + 移除 e2e filter（M26）。

### 批次 9：DB 索引/连接（M27-M30 + M28）
1. `apps/server/src/db/schema/{audit-logs,error-logs,notifications}.ts` — 加索引（M28-M29）。
2. `apps/server/src/db/schema/*.ts` — `updatedAt.$onUpdate`（M27）。
3. `apps/server/src/db/index.ts` — 连接池可配 + max_lifetime（M30）。
> 此批需 `pnpm drizzle-kit generate` 生成新 migration（索引/onUpdate），务必确认 migration 仅加索引/不改业务列。

### 批次 10：剩余中等 + 轻微（M2-M11, M21-M22 + 轻微项）
按优先级议定，逐项 ≤3 文件推进。M2（access token jti + 黑名单）改动较大，建议单独评估。

---

## 六、覆盖率声明

- 后端：common/*（全部）、main.ts、app.module.ts、config/*、db/index/database.module/helpers、db/schema/*（全部 10 表）、modules 下 auth/users/roles/permissions(+role-permissions)/files/error-logs/notifications/audit/routes/setup/schedule/mail/wechat/websocket/health/cache/redis/http-client 的 service+controller+guard、files.service.spec。**未逐行读**：部分 dto 文件、users/roles/notifications spec、wechat.controller、mail.controller、setup.dto（价值递减，按需补）。
- 前端：lib/*、store/*、hooks/*、routes/{users,roles,permissions,files,error-logs,audit-logs,dashboard}。**未读**：login/setup/ws demo 等（按需补）。
- shared+工程化：全部 schemas/constants、package.json/tsconfig/Dockerfile/compose/CI/biome。**未读**：drizzle migration SQL 逐条（shared agent 被拦，建议逐条 cat 核对 0000-0011 与 schema drift、0011 后是否有未迁移改动）。
- seed.ts：含明文邮箱被安全插件反复拦截，**未审**，建议人工复核密码哈希/sql.raw/硬编码。
