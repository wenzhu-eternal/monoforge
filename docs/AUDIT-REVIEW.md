# 全维度审查报告（最终版）

> 仓库 `monoforge`，HEAD 基线同 `CODEBASE-AUDIT.md`。
> 7 维度并行审查 + 5 组独立复核 + 主会话补核收敛。每条均经独立读代码取证。

---

## 决策记录

| # | 问题 | 决定 |
|---|---|---|
| 1 | refresh token body 明文返回 + persist localStorage | **撤销兜底，回纯 httpOnly cookie 方案**（cookie 链路已被 `1d8a012` 修通，兜底多余）|
| 2 | Admin 旁路信 JWT roleId（降权 15min 仍 admin） | **不改**（logout 黑名单已实现 + 15min 短 TTL，可接受）|
| 3 | users:restore 权限 | **收紧到 `USER_DELETE`** |
| 4 | error_logs 管理员不见软删日志 | **保持现状**（归档即移出列表）|
| 5 | wechat 软删后即新建 | **改为拒绝登录**（不新建、不自动 restore）|
| 6 | 缓存死代码 / 多实例备份锁 / PgBouncer prepare | **只改缓存死代码**；多实例锁与 prepare 暂不改 |
| - | sameSite: 'strict' | **保持现状** |

---

## 一、P1 · 必要改（建议优先）

### 安全 / 越权

**1. users:update 可越权改任意人密码/邮箱 → 账号接管**
- `apps/server/src/modules/users/users.controller.ts:94-114` + `packages/shared/src/schemas/user.ts:56-64`
- controller 仅对 `roleId`/`status` 要求 `USER_ROLE_MANAGE`，对 `password`/`email` 无门槛也无归属校验；service 直接 argon2 落库。持 `USER_UPDATE` 可改任意 id 用户密码 → 登录接管。
- **修**：password/email 单独提权（`USER_PASSWORD_RESET` 或并入 `USER_ROLE_MANAGE`），或加 `currentUser.sub === id` 归属校验。

**2. wechat:login 不校验 status → 被禁微信用户重新扫码即解锁**
- `apps/server/src/modules/wechat/wechat.service.ts:130-180`
- `findOrCreateUser` → 直接 `signTokenPair`，全程无 `status===false` 校验（对比 `auth.service.ts:60-62` 账号登录有）。
- **修**：签 token 前补 `if (!user.status) throw UnauthorizedException(USER_DISABLED)`；新建用户显式 `status:true`。

**3. files:findAll 横向泄漏文件元数据**
- `apps/server/src/modules/files/files.controller.ts:57-78` + `files.service.ts:80-120`
- findAll 仅按 `maybeDeleted` 过滤，无 `uploadedBy` 限制；返回 `originalName/size/uploadedBy/uploadedByByUsername`。preview/download 已有 admin/uploader 校验，list 漏了。
- **修**：非管理员追加 `eq(files.uploadedBy, currentUser.sub)`。

**4. Roles.deletedAt 三处鉴权不一致**
- `users.service.ts:223-241`（hasPermission，查了 role.deletedAt）vs `auth.service.ts:324-340`（getPermissionsByUserId，不查）vs `permissions.guard.ts:56-71`（不查）。
- 软删角色后路由放行与 profile permissions 仍按该角色授予，与软删语义矛盾。
- **修**：guard 与 getPermissionsByUserId 两处补 join `roles` 并过滤 `roles.deletedAt`。

**5. Setup TOCTOU 抢注竞态**
- `setup.controller.ts:34-43` + `setup.service.ts:43-92`
- `getStatus` 与 `initialize` 间无锁；不同用户名+不同邮箱并发抢注 → 两个 admin 都成功（`ALLOW_SETUP` 仅降概率非根治）。
- **修**：事务内 `pg_try_advisory_lock` 或首次初始化标志位原子置位；初始化后立即关 `ALLOW_SETUP`。

**6. WeChat OAuth state 形同虚设**
- `wechat.service.ts:102-122` + `wechat.controller.ts:40-59` + `packages/shared/src/schemas/wechat.ts:10-13`
- `getQrCode` 生成 state 写 Redis，但 login DTO 从不读/删 state → CSRF 防护链断开。
- **修**：DTO 加 `state`；login 内 `get`+`del` 校验存在性，不存在抛 401。

### 可靠性 / 崩溃

**7. files preview/download createReadStream 无 error 处理可崩进程**
- `apps/server/src/modules/files/files.controller.ts:112,124,130,166`
- 三处 `createReadStream().pipe(response)` 均无 `stream.on('error')`。`statSync` 抛错能被 filter 兜住；但流式传输中异步 'error'（文件被删/IO 错/客户端中断）无监听器 → uncaughtException → **崩进程**。
- **修**：`pipeline()` 或对 read stream 与 response 都挂 'error'；`statSync` 改 async `stat`。

**8. spawnPgDump stderr 未消费 + 无超时 + reject 不 kill**
- `apps/server/src/modules/schedule/schedule.service.ts:96-108`
- stderr pipe 不读（>64KB 阻塞）；无 timeout（pg_dump 挂起 Promise 永挂）；reject 不 `child.kill()` → 僵尸进程。
- **修**：`child.stderr.on('data')` drain；加 `setTimeout(()=>child.kill('SIGTERM'),N)`；reject 路径 `child.kill()`。

### 数据 / 工程化

**9. permissions/roles/users 四组重复 partial unique 索引**
- `drizzle/0009_late_shocker.sql` + `0010_cultured_microbe.sql`
- 0009 建 `_active_uniq` 4 个，0010 又建同名原 4 个，0010 无 `DROP INDEX` → 4 组 8 个语义相同索引并存，写放大翻倍，`drizzle-kit` 报 diff。
- **修**：补 migration `DROP INDEX IF EXISTS ..._active_uniq`（4 个）。

**10. Dockerfile CMD `npx drizzle-kit migrate` 联网拉最新版**
- `Dockerfile:56` + runtime `--prod`（:41）不装 drizzle-kit（devDep）
- `npx` 启动联网拉最新版 → 气隙环境崩；联网环境版本漂移。
- **修**：把 drizzle-kit 拷进 runtime 镜像，或预生成迁移 SQL 用纯 sql 执行。

**11. Dockerfile runtime prepare 脚本触发 husky not found**
- `Dockerfile:40-41` + `package.json:21` `prepare: "husky && pnpm --filter @monoforge/shared build"`
- runtime `pnpm install --prod` 触发 prepare，但 --prod 不装 husky → `husky: command not found`；shared build 也依赖 typescript（devDep）→ 构建失败。
- **修**：runtime 设 `HUSKY=0` + `--ignore-scripts`；或 `COPY --from=builder node_modules` + `pnpm prune --prod`；prepare 加 `.git` 存在性守卫。

**12. validateFileContent 文件句柄泄漏**
- `apps/server/src/common/file-validator.ts:145-158`
- `await open()` 后 `handle.read()` 抛错则 `handle.close()` 永不执行（无 finally）。对比同文件 `scanForMalware:161-186` 正确用了 finally。
- **修**：`try { ... } finally { await handle.close() }`。

**13. error-logs/report 公开端点无单独限流 + 字段无大小上限**
- `error-logs.controller.ts:44-50` + `packages/shared/src/schemas/error-log.ts:41-52`
- `@Public` + 无 `@Throttle`（仅全局 10/60s/IP）；message/stack/context 无 max，context 是 `z.record(z.unknown())` 任意大小。轮换 IP 可灌爆 error_logs 表。
- **修**：单独 `@Throttle({ default: { limit: 5, ttl: 60_000 } })`；message/stack 加 `.max()`；context 限键数与序列化长度。

---
## 二、P2 · 必要改（建议修但不阻断）

### 业务逻辑一致性

**14. users:create/update 不校验 roleId 是否软删** — `users.service.ts:136-142,196-200`。可把用户绑到软删角色（hasPermission 运行时判 false 兜底）。**修**：绑定时校验 role 存在且未软删。

**15. users:restore 权限收紧到 USER_DELETE**（决策 #3）— `users.controller.ts:118,126`。restore 现要 `USER_UPDATE`，remove 要 `USER_DELETE`。**修**：restore 改 `@Permissions(USER_DELETE)`（或新增 `USER_RESTORE`）。

**16. notifications:unreadCount admin 含软删未读 → 计数≠列表** — `notifications.service.ts:14-19,28-40`。unreadCount 用 `maybeDeleted(includeDeleted)`，unreadOnly list 始终 `notDeleted`。**修**：unreadCount 永远 `notDeleted`。

**17. wechat password 未 argon2 hash** — `wechat.service.ts:256`。`password: randomUUID()` 明文存储。**修**：`await argon2.hash(randomUUID())`。

**18. files:remove 并发丢 trashPath** — `files.service.ts:146-164`。`db.update` 无 `isNull(deletedAt)` 守卫；并发 DELETE 时 B 的 `trashPath=''` 覆盖 A 真实路径。**修**：`.where(and(eq(files.id,id), isNull(files.deletedAt)))` + 校验 affected rows，已软删幂等返回。

**19. files upload 无事务留磁盘孤儿** — `files.service.ts:34-78`。multer 先落盘 → DB insert 失败无清理。**修**：insert 失败 `unlink(file.path)`，或定期 GC 孤儿。

**20. files restore 磁盘失败仍清 deletedAt** — `files.service.ts:186-194`。`rename` 失败仅 warn，照样 `set deletedAt=null` → DB 显示已恢复但磁盘文件仍在 trash → preview/download ENOENT。**修**：rename 失败时不更新 DB 或抛错，保留 trashPath。

**21. files preview Range suffix 误解析 + 无边界校验** — `files.controller.ts:115-127`。正则对 `bytes=-100` 取成前 101 字节而非 RFC 7233 末尾 100 字节；无 `start<=end`/`end<size` 校验。**修**：按 RFC 7233 解析三语法 + clamp 边界，非法返 416。

**22. wechat 软删后改为拒绝登录**（决策 #5）— `wechat.service.ts:219-221,250-273`。existing 查询带 `notDeleted`，软删微信用户再扫码进新建分支。**修**：existing 去掉 `notDeleted`，发现软删用户则抛"账号已注销"拒绝登录，由管理员手动 restore。

**23. wechat openId 前8位碰撞用户名** — `wechat.service.ts:242`。`wx_${openId.slice(0,8)}` 碰撞时 `isUniqueViolation` 抛"微信账号已存在"误导。**修**：用完整 openId 或加随机后缀。

### 错误处理 / 契约

**24. AuthGuard 外层 catch 吞「已吊销」语义** — `auth.guard.ts:60-65`。内层"已吊销"被 `catch { throw '访问令牌无效' }` 覆盖。**修**：catch 内 `instanceof UnauthorizedException` 判断后 rethrow。

**25. storeRefreshToken 静默吞 Redis 错** — `auth.service.ts:309-322`。`:319` catch 后正常返回，login/register 拿 200 但 refresh token 未入 Redis → 下次 refresh 必失败。**修**：存储失败抛 500/ServiceUnavailable 让登录一并失败。

**26. SanitizeBodyPipe 破坏 PATCH 清空语义** — `sanitize-body.pipe.ts:22`。`val === '' || val === null` 都转 undefined → `description:''` 清空失败。**修**：只处理 null 保留 ''，或对允许清空字段白名单。

**27. PaginationQuery.order 必填但后端无排序实现** — `schemas/pagination.ts` `order:'asc'|'desc'` 必填类型，但 `users.service.ts:50` 写死 `orderBy(desc(createdAt))`，不读 sort/order。**修**：实现 sort 白名单 + order 校验接入 orderBy，或把 order/sort 改 optional。

**28. mail.service 抛裸 Error 文案被 filter 吞** — `mail.service.ts:181,203,228`。三处 `throw new Error(...)` 被全局 filter 当 500 + 通用"服务器内部错误"覆盖，MAIL_SEND_FAILED 文案丢失。**修**：抛 `ServiceUnavailableException(ErrorMessages[MAIL_SEND_FAILED])`。

**29. schedule pg_dump argv 泄漏凭据** — `schedule.service.ts:100`。`spawn('pg_dump', [databaseUrl])`，databaseUrl 含密码作为 argv，`ps aux` 可见。**修**：改用 env 传参（`PGUSER/PGPASSWORD/PGHOST` + `--dbname`）。

**30. http-client 重试不区分方法** — `http-client.service.ts`。重试只看 5xx/网络错误，无 `method` 判断，POST/PATCH 5xx 重发产生重复副作用。**修**：默认仅 GET 重试，其他方法需显式 `retryOn5xx:true` + idempotency-key。

**31. error-logs/report 用 id:-1 哨兵**（可选） — `error-logs.service.ts:36-39,61-63`。返 `{id:-1}`；report controller 未挂 `@ZodSerializerDto`，不会触发 `.positive()` 报 500，非契约破坏 bug，仅不优雅。**修（可选）**：改 202 + `{skipped:true, reason:'whitelisted'}`。

### 审计拦截器（4 项同源，建议一并改）

**32. AuditInterceptor newValue 写入响应信封而非纯业务值** — `audit.interceptor.ts:93-104`。tap 收到 ResponseInterceptor 包装后的 `{code,message,data}` 整体入库。**修**：拦截器注册到 ResponseInterceptor 之前，或 `data?.data` 取壳。

**33. AuditInterceptor 失败 PATCH/DELETE 不入审计** — `audit.interceptor.ts:93`。用 `tap`，handler 抛异常时不触发 → 越权试探被挡无审计。**修**：`tap`+`catchError` 双写或 `finalize`，区分成功/失败。

**34. AuditInterceptor fetchOldValue 含敏感字段 + 不带软删过滤** — `audit.interceptor.ts:115-132`。只 `delete password`，email/openid 等仍入 oldValue；且 `.where(eq(id))` 不带 `notDeleted`。**修**：按表配置敏感列清单统一脱敏；补 `notDeleted` 过滤。

**35. AuditInterceptor setup 无 userId 跳过审计** — `audit.interceptor.ts:95` `if (userId)` 才记，setup @Public 无 userId → 创建首个 admin 不入审计。**修**：无 userId 时记 `userId=null`+`ip/ua` 仍落审计。

### token 方案撤销（决策 #1）

**36. 撤销 refresh token body 返回 + localStorage persist，回纯 httpOnly cookie**
- `apps/web/src/store/auth-store.ts` partialize 删 `refreshToken`；`apps/web/src/lib/api.ts:65` `bootstrapAuth` 条件 `!isAuthenticated || token || !refreshToken` 改为 `!isAuthenticated || token`；`api.ts:85` `buildRefreshPayload` 不传 body（留空对象）。
- 后端 `auth.controller.ts:103` 保留 `refreshTokenFromBody ?? request.cookies?.refreshToken` 兜底链路（不改），cookie 链路已被 `1d8a012` 修通（开发态走 Vite 代理同源 + 生产同源 ServeStatic）。
- **收益**：refreshToken 不再暴露 response body + localStorage，XSS 偷不到 7 天长期令牌。

### 缓存死代码清理（决策 #6）

**37. 用户缓存整体死代码 → 删除未生效的缓存设施**
- `cache.interceptor.ts:20` + `users.service.ts:94` + `users.controller.ts:77`
- `@Cacheable` 标在 service `findById`，CacheInterceptor 读 controller handler 元数据 → `cacheKey=undefined` → 缓存读写分支永不执行；`delByPattern('cache:user:*')` 实现是活的但 keyspace 永不写入（无目标可删）。`resolveKey` 不含 isAdmin → 若误挪 `@Cacheable` 到 controller 会引爆 admin/非 admin 缓存污染。
- **修**：直接删掉这套未生效的缓存设施（`@Cacheable` 装饰 + `delByPattern` 调用），等真有性能需要再设计带 isAdmin 的方案。

### 框架 / 工程化

**38. graceful shutdown 不 drain 在飞请求** — `main.ts:75` + `db/database.module.ts:14-18`。`enableShutdownHooks` 立即 `client.end({timeout:5})`，在飞 DB 查询可能抛错。**修**：显式 drain 计时器 + readiness 闸。

**39. PermissionsGuard 每请求 2-3 次 DB 查无缓存** — `permissions.guard.ts:56-95`。**修**：按 roleId 缓存权限码到 Redis，role-permission 变更时 invalidate。

**40. 无 `app.set('trust proxy')` 但依赖 XFF** — `main.ts` + `audit.interceptor.ts:79-80` + `http-exception.filter.ts:109-110`。手动取 XFF 第一段，客户端可伪造 → 审计/限流 IP 污染。**修**：`app.set('trust proxy', N)` 并改用 `request.ip`。

**41. logger flushErrorLog 未挂 graceful shutdown hook** — `common/logger.ts:56-72`。logger 已异步批量（100ms 刷盘），但 `flushErrorLog` 未在 shutdown 调用 → 进程退出丢日志。**修**：`onModuleDestroy` 或 `enableShutdownHooks` 前 `await flushErrorLog()`。
### 数据层

**42. users.roleId FK `onDelete: no action` 与全仓 set null 风格不一** — `users.ts:26` + migration 0013。**修**：`references(() => roles.id, { onDelete: 'set null' })`。

**43. error_whitelist 零索引 + pattern 无唯一** — `error-whitelist.ts:3-15`。report 热路径全表扫（Redis 缓解但失效时全表扫）；pattern 可重复。**修**：`isActive` 部分索引 + `(matchType, pattern)` partial unique。

**44. files 零索引（含 FK 列 uploadedBy）** — `files.ts:4-15`。**修**：`uploadedBy` 索引 + `(deletedAt, createdAt)` 回收站索引。

**45. permissions.routes 用 json 非 jsonb** — `permissions.ts:11` + migration 0008。与全仓 jsonb 风格不一，无法 GIN 索引。**修**：`ALTER COLUMN routes TYPE jsonb USING routes::jsonb`。

**46. 无 statement_timeout / idle_in_transaction_session_timeout** — `db/index.ts:16-22`。慢查询/长事务可耗尽连接池（max 10）。**修**：`statement_timeout: '30s'`、`idle_in_transaction_session_timeout: '10s'`。

**47. keyword 拼 LIKE 未转义 `%`/`_`** — `audit.service.ts:62` + `error-logs.service.ts:106`。功能 bug（搜 `%` 匹配所有）；参数化模板无 SQL 注入。**修**：`keyword.replace(/[%_]/g, '\\$&')` + `ESCAPE '\'`。

---

## 三、暂不改（当前不触发 / 决策不改）

**48. dailyBackup 无分布式锁多实例覆写** — `schedule.service.ts:31,34-36,52,99`。`@Cron` 每实例触发 + 文件名固定 → 多实例覆写损坏。当前单容器不触发。**接入多实例前必修**：Redis 分布式锁或文件名加实例 ID。

**49. 连接池缺 `prepare: false`** — `db/index.ts:12-17`。postgres-js 默认 prepared statements；当前直连 PG 正常。**接入 PgBouncer/Serverless pooler 前必修**。

**50. Admin 旁路信 JWT roleId**（决策 #2 不改）— `permissions.guard.ts:52-54`。降权后 access token 15min 内仍 admin；logout 黑名单已实现 + 15m 短 TTL 可接受。严格场景再与 #4 一并对 admin 旁路补 DB 校验。

---

## 四、设计权衡（保持现状）

**error_logs 管理员不见软删日志**（决策 #4）— `error-logs.controller.ts:80` findAll 不传 includeDeleted。归档即移出列表，管理员也不可见，与 error_logs 不可恢复的定位一致。**保持现状。**

> wechat login 不回 refreshToken body：决策 #1 撤销 token body 返回后，所有登录路径（含 wechat）统一不回 body、仅走 httpOnly cookie，此条自然成立。

---## 五、复核证伪 / 不成立（勿重复发现）

| 原条目 | 结论 |
|---|---|
| error-logs 白名单缓存共用污染 | ❌ 因果反了：checkWhitelist 只读不写缓存，findWhitelist 写含 inactive 全量，靠 matchWhitelist 的 `isActive` 兜底过滤，行为正确。 |
| DB 'DATABASE' token 死代码 | ❌ HealthService `@Inject('DATABASE')` 使用中。 |
| ServeStatic 无 SPA fallback | ❌ @nestjs/serve-static 默认 renderPath `{*any}` 回退 index.html，深链刷新不 404。 |
| server `@shared/*` dist 未改写 → 生产崩 | ❌ `grep @shared dist/*.js` 零命中，tsc 已改写为相对 require。 |
| PermissionsGuard 未注册 providers 是 bug | ❌ NestJS `@UseGuards(GuardClass)` DI 实例化 + 全局 Reflector，官方支持。 |
| notifications `read` JS 字段/`is_read` 列不符 | ❌ Drizzle 标准 camelCase↔snake_case 映射，运行正常。 |
| register 链路断裂（依赖 'user' 角色 setup 不建） | ❌ seed.ts 补建 'user' 角色，链路正常。 |

**seed.ts 复核干净**：argon2 哈希、无 sql.raw、无破坏性 TRUNCATE/DROP、邮箱/密码走 env 覆盖。默认 admin 密码 `'888888'`（可 `SEED_ADMIN_PASSWORD` env 覆盖 + 注释提示修改，生产应设 env，不改代码）。lockfile `jsonwebtoken@9.0.3` 不受 CVE-2022-23529/23539/23540 影响。CODEBASE-AUDIT.md 多条已修但报告未更新（S2/S3/S4/S5/S6/S8/M1/M2/M3/M30），建议复检更新。

---

## 六、统计

| 类别 | 条数 |
|---|---|
| P1 必要改 | 13（#1-#13）|
| P2 必要改 | 32（#14-#47）|
| 暂不改（扩展前必修 / 决策不改） | 3（#48-#50）|
| 设计权衡（保持现状） | 1 |
| 复核证伪/删除 | 7 |

---

## 七、建议处置顺序

**第一批 · P1 安全/崩溃**
#1 越权改密码 · #2 微信绕禁用 · #3 文件列表越权 · #4 roles.deletedAt 不一致 · #5 Setup TOCTOU · #6 WeChat state · #7 文件流崩溃 · #9 重复索引 · #10/#11 Dockerfile

**第二批 · P1 其余 + P2 业务/契约**
#8 pgDump · #12 句柄泄漏 · #13 report 限流 · #14-#23 业务一致性（含 #15 restore 收紧、#22 微信拒绝登录）· #24-#31 错误处理/契约

**第三批 · P2 审计 + token + 缓存 + 工程化**
#32-#35 审计拦截器（同源一并）· #36 token 方案撤销 · #37 缓存死代码清理 · #38-#41 工程化

**第四批 · P2 数据层**
#42-#47

**可选**
#31 id:-1 哨兵改 202

**扩展前必修**
#48 多实例备份锁 · #49 PgBouncer prepare:false
