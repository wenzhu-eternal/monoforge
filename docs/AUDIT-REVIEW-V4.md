# MonoForge 代码审查报告 v4 · 最终版

| 项目 | 内容 |
|---|---|
| 仓库 | `monoforge`（NestJS 后端 `apps/server` + React 前端 `apps/web`） |
| 审查日期 | 2026-08-09 |
| 基线 | 当前工作区代码 |
| 范围 | 认证/JWT、文件服务、WebSocket、输入验证/XSS、配置/部署/Docker、前端权限/路由、注释一致性 |
| 方法 | 5 个并行 subagent 独立审查（未参考任何历史报告）+ 主会话亲自 grep/sed 取证 + V1/V2/V3 交叉核对 |

## 整体结论

**仍有问题。** V4 独立审查发现 5 个 P0 + 18 个 P1 + 17 条注释失真。其中 2 个 P0 是 V3 误判"已修复"导致的遗漏，1 个 P1 是 V2 修复时引入的新问题。

## 严重度概览

| 级别 | 数量 | 说明 |
|---|---|---|
| P0 | 5 | 严重安全漏洞，必须修复 |
| P1 | 18 | 高危，应尽快修复 |
| 注释失真 | 17 | 注释与代码逻辑不符 |

## P0 严重问题（均已取证）

### P0-1 mustChangePassword 后端零校验，默认密码 888888 可长期接管 admin

- **取证**：`grep mustChangePassword apps/server/src` 仅命中 `users.service.ts:287`（改密置 false）、`users.ts:29`（schema）、`seed.ts:13`。`auth.service.ts` / `auth.guard.ts` 零命中。
- **风险**：未设 `SEED_ADMIN_PASSWORD` 时 admin 密码为 `888888`，攻击者登录后直接拿全功能 access token 调任意 API；access token 过期后 `refresh()` 同样不校验 mustChangePassword，可无限续期永久保持 admin。
- **交叉核对**：V2 F18 仅做了前端强制改密，后端强制未落地。
- **修复**：`signTokenPair` payload 携带 mustChangePassword；`AuthGuard` 校验为 true 时除改密相关接口外一律 403；`refresh()` 校验 mustChangePassword。

### P0-2 文件 MIME 校验基于客户端 header，未基于文件内容

- **取证**：`files.service.ts:42` `validateMimeType(file.mimetype)`，multer 的 mimetype 来自客户端 `Content-Type`。`validateFileContent` magic number 仅覆盖 jpg/png/gif/pdf/zip/docx/xlsx，txt/sql/html/svg 等无内容校验。
- **风险**：客户端伪造 Content-Type 即可上传任意内容的文本类文件，配合 preview 接口 inline 渲染构成 XSS。
- **修复**：引入 `file-type` 库基于文件内容检测真实 MIME，与声明 MIME 和扩展名三者交叉比对。

### P0-3 preview/download 未校验 file.path 是否在允许目录内

- **取证**：`files.controller.ts:107-145`（preview）、`:155-185`（download）直接 `stat(file.path)` / `createReadStream(file.path)`，无 `isPathSafe` 调用。upload 方法有校验，preview/download 缺失。
- **风险**：DB 数据被篡改时构成任意文件读取（防御纵深缺失）。
- **修复**：preview/download 读取文件前增加 `isPathSafe(file.path, UPLOAD_DIR)` 校验。

### P0-4 WebSocket 握手不查 jti 黑名单

- **取证**：`events.gateway.ts:160-178` `extractAuth` 用 `jwtService.verify(authToken, { secret })` 仅校验签名，不读 Redis `access:${sub}:${jti}` 黑名单，不注入 RedisService。对比 HTTP 路径 `auth.guard.ts:52-58` 查黑名单。
- **风险**：禁用/改角色用户在 access token 15min TTL 内可建立新 WS 连接；已建立的连接配合 P0-5 永久持有旧权限。
- **修复**：`extractAuth` 解析 jti 后查 Redis 黑名单，命中即拒绝连接；改用 `verifyAsync`。

### P0-5 WS 连接期间无权限/状态重校验

- **取证**：`events.gateway.ts:185-200` `loadUserPermissions` 仅在 `handleConnection` 调用一次，`client.data.permissions/roleId/isAdmin` 整个连接生命周期不刷新。
- **风险**：角色降级后旧连接仍持 admin 权限接收 presence 广播，绕过权限降级。
- **修复**：权限变更时主动断开该用户的所有 socket，客户端重连时走新权限；或设置定时器（如 60s）刷新 `client.data`。

## P1 高危问题

| # | 问题 | 取证 | 交叉核对 |
|---|---|---|---|
| P1-1 | preview 无 nosniff、html/svg 未强制 attachment → XSS | files.controller.ts:107 preview 设 `Content-Type: file.mimeType` 直接 pipe，无 nosniff、无 attachment | V3 误判已修复 |
| P1-2 | error-logs 白名单缓存共用 key 污染 | error-logs.service.ts:28 单一 `WHITELIST_CACHE_KEY`，checkWhitelist(329-335) 写活跃子集、findWhitelist(381-383) 写全集 | V2 F15 修复引入；V3 误判已用不同 key |
| P1-3 | refresh token 仍接受请求体传入 | auth.controller.ts:99-102 `refreshTokenFromBody ?? request.cookies?.refreshToken` | V1 决策#1"撤销兜底"未落地 |
| P1-4 | WS 握手不查 status、不拒软删用户 | events.gateway.ts:185 `notDeleted` 过滤但未查 status，软删用户查不到却仍登记连接 | V1/V2 未提及 |
| P1-5 | WS CORS 在 ALLOW_ORIGIN 未设时放行所有来源 | events.gateway.ts:27 `allowed.length === 0` 时任意 origin 放行 | V1/V2 未提及 |
| P1-6 | preview Cache-Control max-age=31536000 过长 | files.controller.ts:109 | V2 F9 只改 public→private，时长未改 |
| P1-7 | scanForMalware 用 utf8 读二进制文件（漏报/误报） | file-validator.ts:166 `readFile(filePath, 'utf8')` | V1/V2 未提及 |
| P1-8 | rename 跨 Docker 命名卷 EXDEV 失败，软删隔离未实现 | files.service.ts:253,238 + docker-compose.yml:97-98 两个独立命名卷 | V1/V2 未提及 |
| P1-9 | ALLOWED_EXTENSIONS 与 ALLOWED_MIME_TYPES 严重不一致 | file-validator.ts:9-48 | V1/V2 未提及 |
| P1-10 | WS 多实例无 Redis adapter | events.gateway.ts:47 内存 Map，无 createAdapter | V2 F13 决策暂不改（单实例，扩展前必修） |
| P1-11 | 全局限流器内存存储，多实例限流失效 | app.module.ts:44-55 无 storage 配置 | V1/V2 未提及 |
| P1-12 | setup 公开接口无限流 | setup.controller.ts:19-39 @Public 无 @Throttle | V1/V2 未提及 |
| P1-13 | 注册验证码无尝试次数限制 | auth.service.ts:267-285 失败不计数 | V1/V2 未提及 |
| P1-14 | 微信登录接口无限流 | wechat.controller.ts:40-59 无 @Throttle | V1/V2 未提及 |
| P1-15 | requirePermission 参数为死代码，权限码双重声明 | route-guards.ts:45-53 `_permission` 未使用 | V1 M20 提过首屏误 redirect，已修；死代码是新角度 |
| P1-16 | 生产 Redis 无密码保护 | docker-compose.yml:34 无 --requirepass | V1/V2 未提及 |
| P1-17 | __root.tsx 无全局 beforeLoad，未登录可直达 /403、/not-found | __root.tsx:7-25 | V1/V2 未提及 |
| P1-18 | 密码强度 min 6 无复杂度 | shared/schemas/user.ts:22 | V2 F20 决策不改（已知悉） |

## V3 误判澄清

| V3 结论 | 实际取证 | 真相 |
|---|---|---|
| 白名单缓存已修复，使用不同缓存 key | error-logs.service.ts:28 单一 `WHITELIST_CACHE_KEY` | 误判，未用不同 key，污染真实存在（P1-2） |
| preview XSS 已修复，html/svg 强制 attachment + nosniff | files.controller.ts preview 无 nosniff、无 attachment | 误判，未修复（P1-1） |

## V1/V2 证伪过时（代码后改导致问题复现）

**白名单缓存共用污染**：V1 证伪#5 / V2 证伪 D5 称"checkWhitelist 只读不写，无污染"。但 V2 F15 修复（让 checkWhitelist 查库后回填缓存）使 checkWhitelist 也开始写缓存，且用同一 key，回填的是活跃子集，与 findWhitelist 的全集冲突 → 污染复现。当前代码以 V4 P1-2 为准。

## 已确认修复的 V1/V2 项（V4 取证确认）

V1 #1 越权改密码 ✅、V1 #2 wechat 校验 status ✅、V1 #7 文件流崩溃 ✅、V1 #12 句柄泄漏 ✅、V2 F1 refresh 校验禁用 ✅、V2 F2 响应体不返回 token ✅、V2 F3 refresh 限流 ✅、V2 F7 audit OR 括号 ✅、V2 F8 文件软删并发抢锁 ✅、V2 F9 Cache-Control public→private ✅、V2 F10 statSync→async ✅、V2 F12 占位邮箱拒绝 ✅、V2 F14 presence 按权限过滤 ✅、V2 F19 备份不附附件 ✅、V2 F22 setup 去计数 ✅。

## 注释失真清单（17 条）

| # | 文件:行号 | 原文 | 问题 |
|---|---|---|---|
| 1 | wechat.service.ts:250 | "用户名 wx_{openId 前 8 位}" | 实际 `wx_${openId}` 完整 openId |
| 2 | wechat.service.ts:55-60 | "state TTL 5 分钟" | 未说明 miniprogram 不校验 state |
| 3 | users.service.ts:228 | "角色变更强制重新登录走新角色" | 仅吊销 access 未吊销 refresh，无需重新登录 |
| 4 | permissions.guard.ts:127 | "通配符 GET /api/users/*" | 实际已剥离 /api/v1，且 seed 用 :id 非 *，示例失真 |
| 5 | auth.guard.ts:52 | "logout 后 jti 进入黑名单" | 实际含禁用/改角色/改密/删用户多场景 |
| 6 | file-validator.ts:50 | "危险扩展名黑名单（即使改后缀也拒绝）" | 这些扩展名无一在白名单，检查冗余 |
| 7 | file-validator.ts:137 | "仅对 jpg/png/gif/pdf 校验" | 实际 7 种（含 zip/docx/xlsx） |
| 8 | files.service.ts:151 | "检查文件是否已被软删（不管 includeDeleted）" | 函数无 includeDeleted 参数 |
| 9 | files.service.ts:251 | "隔离目录内用 时间戳+原名" | 实际用 DB filename（安全文件名），非原名 |
| 10 | xss.pipe.ts:6 | "全局 ValidationPipe 之后" | 实际在 ZodValidationPipe 之前 |
| 11 | xss.pipe.ts:16 | "清洗 script/onerror/javascript:" | 纯文本的 javascript:/onerror= 不清洗 |
| 12 | error-logs.service.ts:328 | "仅有 admin 写 findWhitelist 时回填" | checkWhitelist 也回填 |
| 13 | events.gateway.ts:180-184 | "与 PermissionsGuard 查询逻辑一致" | 实际不 join permissions、不走缓存 |
| 14 | events.gateway.ts:105-107 | "标记通知已读" | 实际不持久化，仅返回 ack |
| 15 | websocket.tsx:67-69 | "30s 心跳保活" | 实际 10s |
| 16 | .env.example:10 | "Redis (optional)" | env.ts REDIS_URL 必填 |
| 17 | seed.ts:12 | "默认弱密码时强制改密" | 只判断等于 888888，自定义弱密码不强制 |

## 处置建议

**第一批（P0）：** P0-1 mustChangePassword 后端强制、P0-2 文件 MIME 基于内容、P0-3 preview/download 路径校验、P0-4 WS jti 黑名单、P0-5 WS 权限重校验

**第二批（P1 高危）：** P1-1 preview nosniff+attachment、P1-2 白名单缓存拆 key、P1-3 refresh 移除 body、P1-4/P1-5 WS status+CORS、P1-6 缩短缓存、P1-7 二进制扫描编码、P1-8 跨卷 rename

**第三批（P1 部署就绪）：** P1-10 Redis adapter、P1-11 限流分布式存储、P1-12/P1-14 限流、P1-16 Redis 密码

**注释失真：** 17 条，约 10 个文件，单独一批修复（只改注释不动逻辑）
