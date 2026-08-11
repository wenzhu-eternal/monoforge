# monoforge V5 独立审查 + V1/V2/V3/V4 交叉核对最终报告

> 审查方法：6 个并行 subagent 分模块独立审查（认证/JWT、文件服务、WebSocket、输入验证/XSS/限流、配置/部署、前端权限），每个 subagent 仅读当前代码取证，不参考任何历史报告。汇总后与 V1/V2/V3/V4 逐条交叉核对。
>
> 审查日期：2026-08-09
> 基线代码：当前 main 分支

---

## 一、V5 独立审查发现汇总

| 模块 | P0 | P1 | P2 | 注释失真 |
|---|---|---|---|---|
| 认证与 JWT | 0 | 2 | 8 | 2 |
| 文件服务 | 1 | 3 | 4 | 3 |
| WebSocket | 1 | 2 | 5 | 0 |
| 输入验证/XSS/限流 | 1（含 1 注释误导） | 3 | 3 | 5 |
| 配置/部署 | 0 | 5 | 6 | 4 |
| 前端权限 | 0 | 2 | 5 | 2 |
| **合计** | **3** | **17** | **31** | **16** |

---

## 二、与 V1/V2/V3/V4 交叉核对结论

### 2.1 V4 的 5 个 P0 修复状态（全部已修复 ✅）

| V4 编号 | 问题 | V5 取证结论 |
|---|---|---|
| P0-1 | mustChangePassword 后端零校验 | ✅ 已修复：auth.service.ts login/refresh 携带字段 + refresh 拒绝续期 + auth.guard.ts 限制路径 |
| P0-2 | 文件 MIME 校验基于客户端 header | ✅ 已修复：file-validator.ts validateFileMimeType 使用 file-type 库基于内容检测 |
| P0-3 | preview/download 未校验 file.path | ✅ 已修复：controller 中 preview/download 均调用 isPathSafe |
| P0-4 | WS 握手不查 jti 黑名单 | ✅ 已修复：events.gateway.ts extractAuth 校验 `access:${sub}:${jti}` |
| P0-5 | WS 连接期间无权限/状态重校验 | ✅ 已修复：events.gateway.ts 60s 定时 loadUserPermissions 校验 status/deletedAt |

### 2.2 V4 的 18 个 P1 修复状态

| V4 编号 | 问题 | V5 结论 | 状态 |
|---|---|---|---|
| P1-1 | preview 无 nosniff、html/svg 未强制 attachment | **V5 升级为 P0-1**：preview 对 SVG/HTML 直接 inline 渲染且未设 nosniff | ❌ 未修复 |
| P1-2 | error-logs 白名单缓存共用 key 污染 | 已拆分为 WHITELIST_ACTIVE_CACHE_KEY 与 WHITELIST_ALL_CACHE_KEY | ✅ 已修复 |
| P1-3 | refresh token 仍接受请求体传入 | auth.controller.ts 仅从 cookies 读取 | ✅ 已修复 |
| P1-4 | WS 握手不查 status、不拒软删用户 | loadUserPermissions 校验 `eq(users.status, true), notDeleted(users.deletedAt)` | ✅ 已修复 |
| P1-5 | WS CORS 未设 ALLOW_ORIGIN 时放行 | 未配置时 `callback(new Error('CORS not configured'))` | ✅ 已修复 |
| P1-6 | preview Cache-Control max-age=31536000 过长 | 仍为 `max-age=31536000` | ❌ 未修复 |
| P1-7 | scanForMalware 用 utf8 读二进制 | 仍用 `readFile(filePath, 'utf8')` | ❌ 未修复 |
| P1-8 | rename 跨 Docker 命名卷 EXDEV | restore 仍用裸 `rename`，未复用 safeMove | ❌ 未修复 |
| P1-9 | ALLOWED_EXTENSIONS 与 ALLOWED_MIME_TYPES 不一致 | 23 项 MIME 与 23 项扩展名一一对应 | ✅ 已修复 |
| P1-10 | WS 多实例无 Redis adapter | **V5 升级为 P0-2**：缺失 `@socket.io/redis-adapter` | ❌ 未修复 |
| P1-11 | 全局限流器内存存储 | **V5 升级为 P0-3**：ThrottlerModule 未注入 storage | ❌ 未修复 |
| P1-12 | setup 公开接口无限流 | `@Throttle({ default: { limit: 5, ttl: 60_000 } })` | ✅ 已修复 |
| P1-13 | 注册验证码无尝试次数限制 | auth.service.ts 5 次失败后 del 验证码 + 计数器 | ✅ 已修复 |
| P1-14 | 微信登录接口无限流 | V5 未直接审查（不在范围） | ⚠️ 待确认 |
| P1-15 | requirePermission 死代码 | 全部使用 requireAuth | ✅ 已修复 |
| P1-16 | 生产 Redis 无密码保护 | docker-compose redis `--requirepass` | ✅ 已修复 |
| P1-17 | __root.tsx 无全局 beforeLoad | /403 无登录校验、/login 无已登录重定向 | ⚠️ 部分未修复 |
| P1-18 | 密码强度 min 6 无复杂度 | 仍为 `min(6)`（V2 F20 决策不改） | ❌ 决策不改 |

### 2.3 V1/V2 历史决策项复核

| 历史编号 | 问题 | 历史决策 | V5 复核 |
|---|---|---|---|
| V2 F11 | 多实例备份无分布式锁 | 决策不改（单实例） | 未复查 |
| V2 F13 | WS 多实例无 Redis adapter | 决策不改（单实例） | V5 升级为 P0-2 |
| V2 F16 | helmet CSP unsafe-inline | 决策不改 | V5 配置模块 P1-5 再次记录 |
| V2 F20 | 密码策略偏弱 | 决策不改 | V5 认证模块 P1-1 再次记录 |
| V2 F21 | notifications 列表无分页 | 决策不改 | 未复查 |
| V2 F23 | access token 旋转后 WS 重连用旧 token | 决策不改 | 未复查 |

---

## 三、最终未修复问题清单（需处置）

### P0 严重问题（3 条）

#### P0-1 [files.controller.ts:114-148] preview 接口存储型 XSS + 缺少 nosniff
- **来源**：V4 P1-1 升级，V3 误判已修复，V5 独立确认未修复
- **问题**：preview 接口直接将 `file.mimeType` 作为 `Content-Type` 流式返回，ALLOWED_MIME_TYPES 包含 `image/svg+xml` 与 `text/html`，浏览器 inline 渲染执行其中脚本；且未设置 `X-Content-Type-Options: nosniff`，对比 download 接口已设置
- **修复**：
  1. 强制设置 `X-Content-Type-Options: nosniff`
  2. 对 `image/svg+xml`、`text/html` 等可执行类型强制 `Content-Disposition: attachment`
  3. 建立"可 inline 预览白名单"（image/jpeg/png/gif/webp、application/pdf），其余类型一律 attachment

#### P0-2 [events.gateway.ts] WebSocket 未使用 Redis 适配器
- **来源**：V2 F13 决策不改，V4 P1-10 待修复，V5 升级为 P0
- **问题**：缺失 `@socket.io/redis-adapter`，onlineUsers/pushToUser/pushAll/pushToPermitted 全是进程内存，多实例部署下功能崩溃
- **修复**：引入 `@socket.io/redis-adapter` + `@socket.io/redis-emitter`，在 main.ts 注册 `useWebSocketAdapter`

#### P0-3 [app.module.ts:44-55] 限流使用内存存储
- **来源**：V4 P1-11 待修复，V5 升级为 P0
- **问题**：ThrottlerModule 未注入 `storage`，默认进程内内存，多实例下限流阈值放大 N 倍
- **修复**：引入 `@nestjs/throttler-storage-redis`，注入 ThrottlerStorage

### P1 高风险问题（11 条，不含决策不改项）

#### P1-1 [auth.guard.ts:62-71] mustChangePassword 白名单 startsWith 匹配
- **来源**：V5 新发现
- **问题**：`path.startsWith(p)` 会匹配 `/api/v1/auth/me/anything` 等子路径，且不校验 HTTP method
- **修复**：改为精确匹配 `method + path` 组合

#### P1-2 [files.service.ts:259-266] restore 跨卷 EXDEV + 失败后清空 trashPath 导致孤儿文件
- **来源**：V4 P1-8 未修复
- **问题**：restore 用裸 `rename`，跨 Docker 命名卷 EXDEV 失败；catch 后仍 `set({ trashPath: null })`，物理文件成孤儿
- **修复**：复用 `safeMove`；搬盘失败时不清空 trashPath，回滚 deletedAt

#### P1-3 [files.service.ts:57-75] upload 校验失败时 multer 临时文件不清理
- **来源**：V5 新发现
- **问题**：scanForMalware 检出恶意内容后抛错，但恶意文件仍残留 uploads/ 目录
- **修复**：try/catch 包裹校验+入库流程，catch 中 `unlink(file.path)` 后 rethrow

#### P1-4 [file-validator.ts:198] scanForMalware 用 utf8 编码读取二进制
- **来源**：V4 P1-7 未修复
- **问题**：utf8 解码非法字节替换为 U+FFFD，可绕过 `<script` 模式匹配
- **修复**：改用 `readFile(filePath, 'latin1')`

#### P1-5 [events.gateway.ts:75,95-101] DB 异常时连接未处理
- **来源**：V5 新发现
- **问题**：loadUserPermissions 无 try/catch，DB 异常时 client 已加入 onlineUsers 但 permissions 未设置，且不 disconnect，产生虚假在线 + unhandled rejection
- **修复**：loadUserPermissions 内 try/catch，异常时返回 false 触发断连

#### P1-6 [events.gateway.ts:186-212] WS 握手不检查 mustChangePassword
- **来源**：V5 新发现
- **问题**：HTTP 链路限制 mustChangePassword 用户只能访问改密接口，但 WS 握手可正常通过
- **修复**：extractAuth 中读取 mustChangePassword，true 时拒绝握手

#### P1-7 [app.module.ts + 默认 ThrottlerGuard] 限流 key 仅基于 IP
- **来源**：V5 新发现
- **问题**：未覆写 getTracker，已认证接口也按 IP 限流，NAT 误伤 + 多 IP 池绕过暴破限流
- **修复**：自定义 ThrottlerGuard 覆写 getTracker，已认证用户按 userId 维度

#### P1-8 [packages/shared/src/schemas/mail.ts:3-11] 邮件 DTO 未拒绝 @wechat.placeholder
- **来源**：V5 新发现
- **问题**：SendWelcomeMailSchema/SendVerificationCodeMailSchema 用裸 `z.string().email()`，未拒绝占位域
- **修复**：复用 UserEmailSchema 的 refine 规则

#### P1-9 [vite.config.ts:14-17 + tsconfig.json:14-16] vite alias 与 tsconfig paths 指向不一致
- **来源**：V5 新发现
- **问题**：vite 指向 `packages/shared/src`，tsconfig 指向 `packages/shared/dist`，类型检查与运行时行为可能脱节
- **修复**：tsconfig paths 改为指向 `../../packages/shared/src`

#### P1-10 [apps/web/src/lib/api.ts:70-129] axios 拦截器缺少 403 统一处理
- **来源**：V5 新发现
- **问题**：仅处理 401，无 403 分支，后端 403 不会跳 /403，与前端 AuthenticatedLayout 行为不一致
- **修复**：增加 403 分支跳转 /403（排除 /403 与 /login 避免循环）

#### P1-11 [schedule.service.ts:45] BACKUP_CMD 通过 exec 执行，filepath 未转义
- **来源**：V2 D6 证伪（spawn 参数数组），但 V5 指出自定义 BACKUP_CMD 走 exec 字符串拼接未转义
- **问题**：`execAsync(customCmd.replace('{filepath}', filepath))`，若部署路径含 shell 元字符可注入
- **修复**：对 filepath 做 shell 引号转义，或要求模板中 {filepath} 必须在引号内

### P2 中低风险问题（31 条，按模块列出）

#### 认证模块（8 条）
- P2-1 [auth.controller.ts:126] logout clearCookie 未传完整 cookie options
- P2-2 [auth.service.ts:150-157] logout 未清除 access:active 记录
- P2-3 [auth.service.ts:71-79] mustChangePassword 用户 refresh token 残留 Redis 7 天
- P2-4 [auth.service.ts:91-144] refresh token 轮换无并发锁
- P2-5 [auth.service.ts:216 等] argon2 默认参数（memoryCost=4096）低于 OWASP 推荐
- P2-6 [auth.controller.ts:117-138] logout 与 /auth/me 无单独限流
- P2-7 [auth.guard.ts:53] jti 不存在时跳过黑名单检查
- P2-8 [auth.guard.ts:88-89] Bearer 类型大小写敏感，不符合 RFC 6750

#### 文件模块（4 条）
- P2-9 [files.controller.ts:114-148] preview 未设置 Content-Disposition
- P2-10 [file-validator.ts:216-220] isPathSafe 大小写敏感文件系统下理论绕过
- P2-11 [file-validator.ts:107-114] validateFilename 误伤合法 dotfile
- P2-12 [files.controller.ts:41-57] upload 无显式限流

#### WebSocket（5 条）
- P2-13 [websocket.controller.ts:51-70] /websocket/notify 未要求 notification:view 权限
- P2-14 [events.gateway.ts] 无单用户/全局连接数限制
- P2-15 [events.gateway.ts:143-172] WS 推送通道本身不做 XSS 清洗
- P2-16 [events.gateway.ts:236-240] loadUserPermissions 未过滤已删除 permission
- P2-17 [events.gateway.ts:126-129] handlePing 原样回显未校验

#### 输入验证/限流（3 条）
- P2-18 [error-logs.service.ts:109-110] findAll 对 NaN 防御不完整（controller 已兜底）
- P2-19 [setup.controller.ts:33] setup 限流宽松且未二次校验 ALLOW_SETUP（已有 advisory lock 兜底）
- P2-20 [xss.pipe.ts] XssPipe 缺少富文本字段跳过机制（当前无富文本场景，设计地雷）

#### 配置/部署（6 条）
- P2-21 [main.ts:60] ZodValidationPipe 未显式配置 forbidNonWhitelisted 等效行为
- P2-22 [Dockerfile:2,30] 未锁定到镜像 digest
- P2-23 [docker-compose.yml:12,31] 引用不存在的 docker-compose.override.yml 模板
- P2-24 [docker-compose.yml:48-64] e2e-postgres 暴露 5433 到主机用弱密码
- P2-25 [app.module.ts:40-43] 静态文件服务复用全局 CSP
- P2-26 [docker-compose.yml:17,34,56] redis/postgres 默认弱密码硬编码

#### 前端权限（5 条）
- P2-27 [routes/403.tsx:4-6] /403 页面无登录状态校验
- P2-28 [routes/login.tsx:11-13] /login 未对已登录用户做重定向
- P2-29 [authenticated-layout.tsx:165-176] getSelectedKeys 为死代码
- P2-30 [mocks/handlers.ts] 硬编码权限字符串（仅 mock）
- P2-31 [auth-store.ts:26-32] localStorage 持久化 user.permissions 理论篡改窗口

---

## 四、注释失真清单（16 条，本次同步修复）

> V4 的 17 条注释失真已修复，以下是 V5 新发现的注释失真。

| 编号 | 文件:行号 | 原文 | 问题 |
|---|---|---|---|
| C-1 | auth.service.ts:283 | `// 验证码尝试次数限制：5 次失败后删除验证码并锁定 5 分钟` | 实际 del 计数器，无"锁定 5 分钟" |
| C-2 | auth.guard.ts:60 | `// 首登强制改密` | 限定为"首登"略窄，密码重置场景也适用 |
| C-3 | files.service.ts:258 | `// 抢锁成功者负责搬盘；搬盘失败不阻塞恢复流程（文件可能已被外部删除）` | 未指出失败后仍清空 trashPath 导致孤儿文件 |
| C-4 | file-validator.ts:196-197 | `// 读取全文件扫描，防止恶意内容藏在文件后半部分绕过头部扫描` | 实现用 utf8 编码，引入新绕过面 |
| C-5 | xss.pipe.ts:5-6 | `用于全局 ValidationPipe 之后，确保入库数据不含恶意脚本` | 实际在 ZodValidationPipe 之前 |
| C-6 | env.ts:29 | `// Redis: auth/权限缓存/限流强依赖，必填` | 限流实际用内存存储，未强依赖 Redis |
| C-7 | users.controller.ts:53 | `// 防御 NaN: 非数字字符串 parseInt 后为 NaN，需回落到默认值` | 实际抛 BadRequestException |
| C-8 | permissions.controller.ts:51 | `// 防御 NaN: 非数字字符串 parseInt 后为 NaN，需回落到默认值` | 同上 |
| C-9 | error-logs.controller.ts:125 | `// 放大限流（高频查详情）` | "放大"易误解为"加强限流"，实际是放宽阈值 |
| C-10 | env.ts:31 | `// Redis 密码（生产必填；docker-compose 已嵌入 REDIS_URL）` | 代码 `REDIS_PASSWORD: z.string().optional()`，无生产强制校验 |
| C-11 | env.ts:51 | `// 显式允许不安全 cookie（仅 ngrok/单容器 HTTP 调试场景，生产需配合 COOKIE_SECURE=true）` | 与 superRefine 逻辑矛盾，ALLOW_INSECURE_COOKIE=true 时生产可不配 COOKIE_SECURE |
| C-12 | .env.example:11 | `REDIS_URL=redis://localhost:6379` | 无密码，与 docker-compose redis --requirepass 不一致 |
| C-13 | docker-compose.yml:12 | `// 用 docker-compose.override.yml 覆盖端口映射` | 项目未提供该文件模板 |
| C-14 | route-guards.ts:28-31 | `避免 beforeLoad 中使用 localStorage 旧值导致首屏误 redirect` | requireAuth 同样读 localStorage，表述歧义 |
| C-15 | authenticated-layout.tsx:50 | `// 自动刷新用户信息（包括 roles 字段）` | 权限校验依赖 permissions，注释未提 |
| C-16 | file-validator.ts:50 | `// 危险扩展名黑名单（即使改后缀也拒绝）` | 这些扩展名无一在白名单，检查冗余 |

> 注：C-16 与 V4 #6 重复，若 V4 已修复则跳过；本次复核确认当前仍存在。

---

## 五、最终结论

### 5.1 已确认修复的核心安全项（V4 P0 全部修复）

V4 报告中的 5 个 P0 严重问题（mustChangePassword 后端校验、文件 MIME 内容校验、preview/download 路径校验、WS jti 黑名单、WS 权限重校验）**全部已修复**，核心认证与文件服务链路安全基线达标。

### 5.2 仍存在的问题（上线前必须修复）

- **P0（3 条）**：preview 存储型 XSS、WS 无 Redis 适配器、限流内存存储
- **P1（11 条）**：mustChangePassword 白名单精度、restore 跨卷+孤儿文件、upload 残留清理、scanForMalware 编码、WS DB 异常处理、WS mustChangePassword、限流 key 维度、邮件 DTO 占位域、vite/tsconfig 不一致、axios 403 拦截、BACKUP_CMD 转义

### 5.3 决策不改项（已知悉风险）

- V2 F20 / V4 P1-18：密码强度 min 6 无复杂度
- V2 F16：CSP unsafe-inline（兼容 Swagger）
- V2 F21：notifications 列表无分页
- V2 F23：WS 重连用旧 token

### 5.4 本次同步处置

- 注释失真 16 条：本次同步修复（仅改注释，不动逻辑）

---

## 六、相关文件清单

P0/P1 涉及文件（绝对路径）：
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/server/src/modules/files/files.controller.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/server/src/modules/files/files.service.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/server/src/common/file-validator.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/server/src/modules/websocket/events.gateway.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/server/src/app.module.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/server/src/modules/auth/auth.guard.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/server/src/modules/auth/auth.service.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/server/src/modules/schedule/schedule.service.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/packages/shared/src/schemas/mail.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/web/vite.config.ts`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/web/tsconfig.json`
- `/Users/hengxinsky/Downloads/openSpace/monoforge/apps/web/src/lib/api.ts`
