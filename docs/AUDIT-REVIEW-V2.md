# MonoForge 代码审查报告 v2 · 最终版

| 项目 | 内容 |
|---|---|
| 仓库 | `monoforge`（NestJS 后端 `apps/server` + React 前端 `apps/web`） |
| 审查日期 | 2026-07-31 |
| 基线 | 当前工作区代码（HEAD `7809c47` 及之后未提交改动） |
| 范围 | `apps/server/src` + `apps/web/src` + 根 `Dockerfile`/`.env.example`，行业级全量 |
| 方法 | 完全独立于 `docs/` 下历史报告，逐文件读 + grep 取证 + 交叉证伪；关键结论附 `文件:行号` |
| 取证 | `seed.ts`、`.env.example` 含敏感字符串，经用户授权后读取完毕 |

## 整体结论

基架健康度**良好**：JWT 吊销/旋转、全局 XSS 清洗、文件上传安全链、软删归属校验、分页边界、env zod 校验、错误不泄露堆栈均到位。本次独立审查发现 **1 个 P0 + 5 个 P1 + 17 个 P2**，另 7 项证伪。每条已逐条与业主确认处置决策：**15 条修复、8 条不改**。

## 严重度与处置概览

| 级别 | 数量 | 修复 | 不改 |
|---|---|---|---|
| P0 | 1 | F1 | — |
| P1 | 5 | F2 F3 F4 F6 | F5 |
| P2 | 17 | F7 F8 F9 F10 F12 F14 F15 F18 F19 F22 | F11 F13 F16 F17 F20 F21 F23 |
| 证伪 | 7 | — | D1–D7（不计入） |

---

## 处置决策台账

| # | 级别 | 问题 | 决策 | 处理 |
|---|---|---|---|---|
| F1 | P0 | refresh 不校验禁用状态 | 改 | refresh 加 status 校验 + 封禁时吊销 refresh |
| F2 | P1 | refreshToken 明文回 body | 改 | 三处 return 去 refreshToken，仅留 cookie |
| F3 | P1 | refresh 无限流 | 改 | 加 `@Throttle` |
| F4 | P1 | user 角色持 user:view → PII 披露 | A | seed 删 user 角色的 user:view |
| F5 | P1 | user 角色持 mail:send + 验证码端点不持久 + 无白名单 | D | 全保留现状（风险已知悉） |
| F6 | P1 | .env.example 公开 JWT 密钥能通过 min32 | A | 占位符 + env.ts 黑名单 + README 提示 |
| F7 | P2 | audit keyword OR 优先级 bug（drizzle 源码实证） | 改 | raw sql 显式加括号 |
| F8 | P2 | files 软删并发致 restore 404 | A | DB 条件抢锁先，成功者再搬盘 |
| F9 | P2 | 预览 Cache-Control: public | A | 改 `private` |
| F10 | P2 | statSync 同步阻塞 + 500 | 改 | `fs/promises.stat` + 404 兜底 |
| F11 | P2 | 多实例 @Cron 备份无锁 | A | 暂不改（单实例，扩展前必修） |
| F12 | P2 | wechat 占位邮箱可被抢占 DoS | A | register schema 禁 @wechat.placeholder 域 |
| F13 | P2 | WebSocket 多实例无 adapter | A | 暂不改（单实例，扩展前必修） |
| F14 | P2 | WS presence 广播泄露全员在线 | A | 按 notification:view/admin 过滤接收方 |
| F15 | P2 | checkWhitelist 缓存 miss 不回填 | 改 | 查库后回填缓存 |
| F16 | P2 | CSP unsafe-inline | A | 维持现状 |
| F17 | P2 | trust proxy 1 | A | 维持现状（确认单层代理） |
| F18 | P2 | 默认 admin 密码 888888 | A | 首登强制改密（mustChangePassword） |
| F19 | P2 | 备份 .sql 邮件附件外发 | A | 不附附件，邮件只发文字通知 |
| F20 | P2 | 密码策略偏弱（min6） | D | 维持现状 |
| F21 | P2 | 通知无分页 | B | 维持现状（50 条够用） |
| F22 | P2 | setup /status 公开计数 | A | 去掉 userCount/roleCount，只留 initialized |
| F23 | P2 | WS 重连用旧 token | A | 不改（边缘问题） |

---

## P0 缺陷

### F1. `refresh` 不校验用户禁用状态——禁用用户可无限续期绕过封禁 ✅ 改
`apps/server/src/modules/auth/auth.service.ts:110-126`

`refresh()` 查到用户后只校验 `notDeleted(deletedAt)`，**无 `user.status` 判断**；对比 `login()` 在 `:66-68` 有 `if (user.status === false) throw USER_DISABLED`。`AuthGuard`(`auth.guard.ts:48-64`)、`PermissionsGuard`(`permissions.guard.ts:64-76`) 也不查 `status`，且封禁时 `users.service.update` 不删除其 Redis refresh token。

- 场景：管理员 `PATCH /users/:id` 置 `status=false` 封禁；该用户仍持 7 天 refreshToken。每次 refresh：校验 `refresh:{sub}:{jti}` 存在 → 查到用户（未软删）→ 签发新 access/refresh。封禁用户在 7 天窗口内持续访问全部接口，**封禁形同虚设**。
- 修复（已决策）：`refresh()` 查到 user 后补 `if (user.status === false) throw UnauthorizedException(USER_DISABLED)`；`users.service.update` 将 `status` 置 false 时 `deleteByPattern(`refresh:${id}:*)` 主动吊销。

---

## P1 缺陷

### F2. refreshToken 明文返回 response body ✅ 改
`apps/server/src/modules/auth/auth.controller.ts:52`（login）、`:88`（register）、`:118`（refresh）

三端点在 response body 返回 `refreshToken`（同时已设 httpOnly cookie）。前端 `api.ts`/`use-auth.ts` 实际只用 cookie，body 中的 refreshToken 是多余暴露面——XSS 读响应体或日志记录 body 会泄露 7 天长期令牌，抵消 httpOnly cookie 防护。
- 修复（已决策）：三处 `return` 移除 `refreshToken` 字段，仅留 `accessToken` + cookie。

### F3. `refresh` 接口无限流 ✅ 改
`apps/server/src/modules/auth/auth.controller.ts:93-95`

`@Post('refresh')` 标 `@Public()` 但**无 `@Throttle`**。对比 `login`(`:37` 5/min)、`register`/`send-register-code`(`:59/:68` 3/min)。攻击者可用窃取的 refreshToken 高频刷新或暴力探测。
- 修复（已决策）：加 `@Throttle({ default: { limit: 10, ttl: 60_000 } })`。

### F4. `user` 角色授 `user:view`——任何注册用户可读全量用户 PII ✅ 改（A）
`apps/server/src/db/seed.ts:178-183` + `apps/server/src/modules/users/users.controller.ts:73-81` + `users.service.ts:90-102`

seed 给 `user` 角色（注册用户）分配 `user:view`。`GET /users/:id` 仅校验 `USER_VIEW`，`findById` 返回除 password 外全字段（含 `email`/`phone`）；`GET /users` 列表同样含 `email`/`phone`。任何人经公开 `POST /auth/register` 注册即得 `user` 角色 → 列出全员 email/手机号 + 读任一用户完整资料。
- 修复（已决策 A）：seed 删 `user` 角色的 `user:view`（管理后台，注册用户不该看用户管理）。

### F5. `user` 角色授 `mail:send` + 无收件人白名单 + 验证码端点不持久 ❌ 不改（D）
`apps/server/src/db/seed.ts:178-183` + `apps/server/src/modules/mail/mail.controller.ts:36-45` + `mail.service.ts:84-85`

seed 给 `user` 角色分配 `mail:send`；`to` 仅 `z.string().email()` 无白名单；`/mail/verification-code` 不传 code，service 随机生成且不持久（注册流程走 `auth.service` 自带 code+Redis，与此端点无关）。任何注册用户可对任意合法邮箱滥发验证码/欢迎邮件。
- 决策：**D 全保留现状**。风险（注册用户可滥发邮件）已知悉并接受。

### F6. `.env.example` 内置公开可知的 JWT 密钥且能通过启动校验 ✅ 改（A）
`.env.example:14-15`

```
JWT_SECRET=your-super-secret-jwt-key-change-in-production-32chars
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production-32chars
```

长度 ≥32，**能通过 `env.ts` 的 `z.string().min(32)` 校验**，app 正常启动；但该字符串随仓库公开。部署人 `cp .env.example .env` 不改密钥 → 生产用公开密钥，攻击者可伪造 admin JWT。min32 校验能挡空/短密钥，**挡不住这种公开长密钥**。
- 修复（已决策 A）：`.env.example` 密钥改占位符（启动失败强制填）+ `env.ts` 黑名单拒绝与示例相同的密钥 + README 提示。

---## P2 缺陷

### F7. audit keyword 搜索 OR 优先级 bug ✅ 改（drizzle 源码实证）
`apps/server/src/modules/audit/audit.service.ts:60-65`

```ts
conditions.push(sql`${users.username} LIKE ${...} OR ${auditLogs.resource} LIKE ${...}`)
```

实证 `drizzle-orm@0.45.2` 的 `and()`（`node_modules/.../sql/expressions/conditions.cjs:64`）：多条件时整体包 `(...)`，但**不对每个 raw `sql` 操作数单独加括号**。故 `keyword + 其他过滤` 生成 `(cond1 AND username LIKE .. OR resource LIKE ..)`，因 AND 优先级高于 OR，`resource LIKE` 单独成立时**绕过 userId/action 等过滤**。`audit:view` 在 seed 中仅 admin 持有，故为过滤逻辑 bug 而非越权。
- 修复（已决策）：`sql`(${A} OR ${B})`` 显式加括号。

### F8. files 软删并发致 restore 后 404 ✅ 改（A）
`apps/server/src/modules/files/files.service.ts:175-188,193-217`

两并发删除同文件：A.moveToTrash 成功（真 trashPath），B 因源已被 A 搬走 → 返回 `''`。DB `update` 带 `isNull(deletedAt)` 守卫只保证一个成功，若 B 先赢（`trashPath=''`），A 落空 → DB 记 `trashPath=''`，物理文件在 A 的 trash 路径（已丢失）。`restore` 时 `if (file.trashPath)` 为假跳过 rename → 永久 404。需近同时双删同文件，概率低但真实数据损坏。
- 修复（已决策 A）：改为 DB 条件更新抢锁先、成功者再搬盘，消除"先搬盘后抢锁"错配。

### F9. 文件预览 `Cache-Control: public` ✅ 改（A）
`apps/server/src/modules/files/files.controller.ts:107` — 预览设 `public, max-age=31536000`，无 `Vary`。文件私有（`:101` 有归属校验），共享代理/CDN 可能按 URL 缓存后跨用户串读。当前单容器无共享缓存层不触发。
- 修复（已决策 A）：改 `cache-control: private, max-age=31536000`。

### F10. `statSync` 同步阻塞 + 未捕获 500 ✅ 改
`apps/server/src/modules/files/files.controller.ts:110` — `statSync` 同步阻塞事件循环；`findByIdRaw` 与 `stat` 间文件被删则抛 ENOENT 未捕获 → 500。
- 修复（已决策）：`fs/promises` 的 `stat`，并兜底 404。

### F11. 多实例 `@Cron` 备份无分布式锁 ❌ 不改（A）
`apps/server/src/modules/schedule/schedule.service.ts:31-36` — `@Cron` 每实例触发，文件名固定 → 多实例覆写损坏。**决策 A：单实例暂不改，扩展前必修（Redis 锁 + 文件名加实例 ID）。**

### F12. wechat 占位邮箱可被抢占致登录 DoS ✅ 改（A）
`apps/server/src/modules/wechat/wechat.service.ts:262-263` + `packages/shared/src/schemas/user.ts` — 占位邮箱 `wx_${openId}@wechat.placeholder` 固定可预测；`RegisterWithCodeSchema.email` 仅 `z.string().email()`，`.placeholder` 作 TLD 字符数 ≥2 能通过。攻击者预先注册该邮箱，微信用户首次登录唯一冲突 → 抛"微信账号已存在" → 永远无法登录。需提前知 openId（semi-secret），严重度低。
- 修复（已决策 A）：register schema 加 `.refine(email => !email.endsWith('@wechat.placeholder'))`。

### F13. WebSocket 多实例无 Redis adapter ❌ 不改（A）
`apps/server/src/modules/websocket/events.gateway.ts:43,107-114` — 内存 Map + pushToUser 只推本实例。**决策 A：单实例暂不改，扩展前必修（socket.io Redis adapter）。**

### F14. WebSocket presence 广播泄露全员在线状态 ✅ 改（A）
`apps/server/src/modules/websocket/events.gateway.ts:69,83,116-118` — `pushAll('presence:update', {userId, online})` 广播给所有连接用户，未按接收方权限过滤。
- 修复（已决策 A）：connection 时解析权限，presence 事件仅推给持 `notification:view`/admin 的连接。

### F15. `checkWhitelist` 缓存 miss 不回填 ✅ 改
`apps/server/src/modules/error-logs/error-logs.service.ts:281-301` — `/error-logs/report` 公开高频（已限流 5/min/IP）；`checkWhitelist` miss 查库后不回填缓存，仅 admin 调 `findWhitelist` 才回填。白名单少时缓存长期空。有限流兜底，影响有限。
- 修复（已决策）：`checkWhitelist` 查库后回填缓存。

### F16. helmet CSP `unsafe-inline` ❌ 不改（A）
`apps/server/src/main.ts:31` — **决策 A：维持现状**（SPA+Swagger 兼容妥协）。

### F17. `trust proxy 1` 多代理可绕限流 ❌ 不改（A）
`apps/server/src/main.ts:23` — **决策 A：确认单层代理，`trust proxy 1` 正确，不改。**

### F18. 默认 admin 密码 `888888` ✅ 改（A）
`apps/server/src/db/seed.ts:11` + `.env.example:36` — `ADMIN_PASSWORD ?? '888888'`，env 不校验 seed 密码强度。首次部署未设 env 则弱密码上线。
- 修复（已决策 A）：首登强制改密（加 `mustChangePassword` 机制）。**跨端大改，单独出子方案。**

### F19. 备份 `.sql` 邮件附件外发 ✅ 改（A）
`apps/server/src/modules/schedule/schedule.service.ts:61-66` + `mail.service.ts:128-135` — 备份成功邮件附完整 `.sql` 导出物，整库经邮件外发。
- 修复（已决策 A）：不附附件，邮件只发文字通知；备份文件留服务器 `backups/`（已有 `cleanOldBackups` 保留 30 份）。

### F20. 密码策略偏弱 ❌ 不改（D）
`packages/shared/src/schemas/user.ts` — `min(6)` 无复杂度。**决策 D：维持现状。**

### F21. notifications 列表无分页 ❌ 不改（B）
`apps/server/src/modules/notifications/notifications.service.ts:22-25` — `limit:50` 无 offset。**决策 B：50 条够用，不改。**

### F22. setup `/status` 公开泄露计数 ✅ 改（A）
`apps/server/src/modules/setup/setup.controller.ts:23-28` — `@Public()` 返回 `userCount`/`roleCount`。
- 修复（已决策 A）：去掉 `userCount`/`roleCount`，只留 `initialized`（setup 流程需要）。

### F23. access token 旋转后 WS 重连用旧 token ❌ 不改（A）
`apps/web/src/lib/ws.ts:19,29` — **决策 A：边缘问题，刷新可恢复，不改。**

---## 证伪（曾怀疑 / agent 报，但实际不成立，勿重复发现）

| # | 原怀疑 | 结论 |
|---|---|---|
| D1 | files `findAll` 的 `currentUser` 可选致非 admin 看全量文件（agent 报 P0） | ❌ `FilesController` 类级 `@UseGuards(PermissionsGuard)`，全局 `AuthGuard` 保证非 public 路由 `request.user` 必注入；`files.service.findAll:100` 非 admin 且有 userId 时按 `uploadedBy` 过滤。 |
| D2 | 删除权限后 `perm:role` 缓存残留 | ❌ `permissions.service.remove:125-146` 删前校验角色绑定，有绑定的权限不可删，故无残留。 |
| D3 | error-logs report 字段无长度限制可填表 | ❌ `ReportErrorSchema`：message≤5000、stack≤10000、context 序列化≤10KB 且键≤20；且 `report` 已 `@Throttle` 5/min/IP。 |
| D4 | 白名单空 pattern 抑制全部错误 | ❌ `CreateErrorWhitelistSchema.pattern = z.string().min(1).max(500)`，拒空。 |
| D5 | error-logs 白名单缓存"共用污染" | ❌ `checkWhitelist` 只读缓存，`findWhitelist` 写，`matchWhitelist` 的 `isActive===false` 兜底，行为正确。（miss 不回填是另一事，见 F15。） |
| D6 | `BACKUP_CMD` 走 shell 注入 | ❌ 属管理员 env 配置，`filepath` 受控；pg_dump 走 spawn 参数数组。 |
| D7 | `AuthGuard` 不查库 status 是缺陷 | ❌ 属 JWT 无状态设计权衡；根因在 F1（修 F1 即覆盖）。 |

---

## 实施计划（按文件拆批，每批 ≤3 文件）

| 批 | 文件 | 含修复 | 状态 |
|---|---|---|---|
| 1 | `auth.service.ts` + `auth.controller.ts` + `users.service.ts` | F1、F2、F3 | 待开工 |
| 2 | `audit.service.ts` + `error-logs.service.ts` + `files.service.ts` | F7、F15、F8 | 待开工 |
| 3 | `files.controller.ts` | F9、F10 | 待开工 |
| 4a | `seed.ts` + `.env.example` | F4、F6（示例密钥占位符） | 待开工 |
| 4b | `env.ts` + `README.md` | F6（黑名单 + 提示） | 待开工 |
| 5a | `events.gateway.ts` + `packages/shared/src/schemas/user.ts` + `setup.service.ts` | F14、F12、F22 | 待开工 |
| 5b | `schedule.service.ts` + `mail.service.ts` | F19 | 待开工 |
| 6 | （单独子方案） | F18 跨端：schema 加 `mustChangePassword` + 迁移 + auth 检测 + 前端强制改密页 | 待出方案 |

不改的 8 条（F5、F11、F13、F16、F17、F20、F21、F23）不进入实施计划。

---

## 附录：本次审查的干净项（抽样）

- **JWT 生命周期**：access 黑名单 + refresh Redis 白名单 + 旋转时旧 jti 立即作废（`auth.service.ts:119,143`）；logout 吊销全设备 refresh + 当前 access。
- **文件上传**：filename/size/MIME/扩展名/magic number/恶意模式/路径穿越/安全文件名 全链校验（`file-validator.ts`）；DB 失败清磁盘。
- **全局 XSS 清洗**：`main.ts:60` `SanitizeBodyPipe → XssPipe → ZodValidationPipe` 生效；`xss` 库空白名单 strip。
- **错误不泄露堆栈**：`http-exception.filter.ts` 5xx 统一回"服务器内部错误"，堆栈仅入文件日志 + DB；body 经 `SanitizeMiddleware` 脱敏后入库。
- **软删归属**：files remove/restore/preview/download、notifications 全量按 `user.sub` 在 DB 层过滤；`includeDeleted` 由 `isAdminUser` 决定，非 query 入参。
- **env 校验**：`env.ts` zod 强制 JWT min32、COOKIE_SECURE 生产警告、ALLOW_SETUP 默认关、ADMIN_ROLE_ID 默认 1。
- **前端**：XSS 注入点 0 命中；token 不落 localStorage（access 内存 + refresh httpOnly cookie）；权限校验等 `useCurrentUser` 加载完再判（`authenticated-layout.tsx:50-55`）；401 刷新队列带 15s 超时，失败登出+重定向。
- **外部 HTTP**：超时 + 仅 5xx/网络错误指数退避重试（`http-client.service.ts`）。
- **Redis/DB**：`deleteByPattern` 用 SCAN；连接池 `statement_timeout=30s`/`idle_in_transaction=10s`/`max_lifetime=30m`/`DB_POOL_MAX` 可配。
- **Setup**：`pg_try_advisory_lock` + 事务内二次查计数，TOCTOU 已防；`ALLOW_SETUP` env 门控。
- **分页**：所有 service 统一 `Math.max(1,page)`+`Math.min(100,pageSize)`，controller 防 NaN。
