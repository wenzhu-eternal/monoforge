# 安全规范

## 认证链路

### 软删除过滤（高危）

`auth.service` 的所有用户查询必须加 `notDeleted(users.deletedAt)`：

- **login** - 已删除用户不得登录

- **refresh** - 已删除用户的 refresh token 不得刷新

- **getProfile** - 已删除用户不得获取自身 profile

- **register** - 已删除用户名/邮箱不得占用注册（否则同名永远无法重建）

- **getPermissionsByUserId / getRoleByUserId** - 中间步骤也要过滤

`wechat.service.findOrCreateUser` 的 `findFirst` **故意不加** `notDeleted(users.deletedAt)`：需查到软删用户才能抛「账号已注销」401；若过滤掉会被当作新用户重建，触发 `openId` 唯一索引冲突。软删即拒绝登录（见 wechat.service.ts 对应注释）。

`getRoleByUserId` 查询 role 时必须加 `notDeleted(roles.deletedAt)`，已删除角色的权限不得生效。

### JWT 双 Token 机制

| Token          | 有效期   | 存储位置                    | 用途               |
| -------------- | ----- | ----------------------- | ---------------- |
| access\_token  | 15 分钟 | Authorization Header    | API 认证           |
| refresh\_token | 7 天   | HttpOnly Cookie + Redis | 刷新 access\_token |

- refresh\_token 使用 HttpOnly + Secure + SameSite=Strict Cookie

- 密码用 argon2id 哈希

- Refresh Token 在 Redis 中存储，支持多设备登录与强制登出

- 刷新流程：旧 refresh 验证 → Redis 删除旧 refresh → 签发新 access + refresh → 新 refresh 存 Redis（轮换）

- **登出批量吊销**：logout 删除 Redis 中全部 refresh（`refresh:{userId}:*`）外，还必须 `revokeAllAccessTokens`——扫描 `access:active:{userId}:*` 活跃索引，逐个把 jti 写入 `access:{userId}:{jti}` 黑名单（TTL = access 剩余有效期），再删除索引。仅吊销当前请求的 token 会放行其他设备的活跃 access token

- **前端登出必须清空查询缓存**：后端吊销 token 只解决服务端会话，客户端 React Query 缓存仍在内存中（默认 `gcTime` 5 分钟）。若登出只清 zustand，下一个用户在同一浏览器标签登录后，会先渲染上一个用户的 `users`/`files`/`error-logs` 等缓存数据，造成跨账号数据泄漏。统一走 `clearUserScopedState()`（`apps/web/src/lib/auth-cleanup.ts`）：同时执行 `useAuthStore.logout()` + `queryClient.clear()`。**所有登出入口（用户主动登出、改密后登出、refresh 失败、bootstrapAuth 失败）必须调用该函数，禁止直接调 `logout()`**

### 密码策略

- `PasswordSchema`（注册/创建用户/重置密码）：至少 8 位且必须同时包含字母和数字

- `LoginSchema` 单独宽松化（仅非空校验）：历史弱密码用户仍可登录，配合 `mustChangePassword` 标记走强制改密流程，避免升级策略后存量用户被锁死

### Cookie 安全

- `secure` flag 必须由环境变量控制，不能硬编码 `true`/`false`

- `sameSite` 必须为 `Strict` 或 `Lax`（不允许 `None` 除非有明确跨站需求）

### 请求体校验

- 所有请求体必须经 Zod 校验管道，禁止裸传对象，防止 SQL 注入和字段污染

- 全局管道链：`SanitizeBodyPipe → XssPipe → ZodValidationPipe`

## 初始管理员保护

- **ADMIN\_ROLE\_ID 匹配的用户不可删除**（基于 `user.roleId === ADMIN_ROLE_ID`，env 默认 1）

- 前端：删除按钮 `disabled`，Popconfirm 禁用并提示「初始管理员账号不可删除」

- 后端：`users.service.remove` 二次校验 `if (isAdminUser(existingUser)) throw new ConflictException(ErrorMessages[ErrorCodes.INITIAL_ADMIN_CANNOT_DELETE])`

## 文件上传安全

多重安全检查（顺序执行，任一失败即拒绝）：

1. **magic number 校验** - 验证文件头真实类型，防止伪装扩展名
2. **恶意内容扫描** - 检查文件内容是否含恶意代码；扫描前解码 XML 数值实体并剥离 `\r\n\t`，防止 `jav&#x0A;ascript:`、`&#106;avascript:`、`data&#58;text/html` 等变形绕过字面正则（L13）
3. **路径遍历防护** - 文件名清洗，禁止 `..`、`/`、`\` 等路径字符
4. **扩展名黑名单** - 禁止 `.exe`/`.bat`/`.sh`/`.php` 等可执行扩展名
5. **大小限制** - 单文件最大 10MB（限制值由 `packages/shared/src/constants/files.ts` 的 `MAX_FILE_SIZE` 统一管理，前后端共享，禁止在 controller/页面内硬编码）
6. **MIME 白名单** - 仅允许图片/文档等安全类型；`text/html` 已剔除（M4/J1=A：HTML 可内嵌脚本，静态托管/预览即 XSS 面，脚手架默认最小开口）。`image/svg+xml` 保留，但恶意内容扫描额外覆盖 `<iframe`/`<embed`/`<object`/`<foreignObject` 等可内嵌脚本/外链的容器标签；**`svg` 永不进入 `INLINE_SAFE_MIME_TYPES`**，预览/下载一律 `attachment` + `nosniff`（L13，实体解码增强也不得放松）
7. **扩展名白名单** - 与 MIME 白名单联合校验（`html`/`htm` 已同步剔除）

### 文件存储

- 本地磁盘存储（`uploads/` 目录）

- 文件名清洗 + 随机化（防止覆盖和遍历）

- DB schema：`id, filename (disk name), originalName, mimeType, size, path, uploadedBy (userId), createdAt`

### 文件删除权限

- 仅管理员（`isAdminUser`）或原始上传者可删除文件

- **软删时磁盘文件必须移到隔离目录**：`files.service.remove` 在 `set({ deletedAt })` 前调用 `moveToTrash(filePath, filename)`，将文件 `rename` 到 `uploads-trash/{时间戳 base36}-{文件名头尾截断}`（L13）。文件不经静态目录对外托管：预览/下载统一走 `GET /files/:id/preview|download` 的鉴权端点，`uploads-trash/` 无任何 URL 可达路径。`rename` 失败仅告警不阻断软删（DB 记录仍标记删除），保证业务可用性。超 30 天的软删文件由每日 0:30 cron 物理清理（磁盘双路径 + DB 行，J3）

## 越权防护

### 用户角色/状态变更（防提权）

`PATCH /users/:id` 必须区分"改资料"与"改角色/状态"两类操作，权限分层：

- **改资料**（email/nickname/avatar 等）：持 `USER_UPDATE` 即可

- **改角色/状态**（roleId/status）：必须额外持 `USER_ROLE_MANAGE` 权限码

- **自改角色**：`currentUser.sub === id` 且携带 `roleId` 时一律 403（含 admin），防止误操作锁死自己或借他人会话提权

- **改邮箱**（含自改）：必须额外持 `USER_ROLE_MANAGE`——邮箱换绑是账号接管链路的一环，自改无门槛会被泄露 token 利用

- **改他人密码**：必须额外持 `USER_ROLE_MANAGE`；改自己密码必须走 `POST /users/me/password`（验证旧密码）

- **创建用户指定角色**（`POST /users` 传 `roleId`）：同样必须持 `USER_ROLE_MANAGE`，否则低权限用户可借创建接口直接造出管理员账号（绕过 update 校验的提权后门）

controller 检查逻辑：

```ts
if (updateUserDto.roleId !== undefined || updateUserDto.status !== undefined) {
  // 自改角色一律禁止（含 admin）
  if (currentUser.sub === id && updateUserDto.roleId !== undefined) {
    throw new ForbiddenException('不能修改自己的角色')
  }
  const canManage = await this.usersService.hasPermission(
    currentUser.sub,
    PermissionCodes.USER_ROLE_MANAGE,
  )
  if (!canManage) {
    throw new ForbiddenException('修改角色/状态需要更高权限')
  }
}
```

`users.service.hasPermission(userId, permissionCode)` 通过 `rolePermissions` 表查询用户角色是否拥有指定权限码；ADMIN\_ROLE\_ID 匹配的用户（`isAdminUser`）短路返回 `true`。

### 角色权限更新（防自提权）

`role-permissions.service.updateRolePermissions` 必须接收调用者上下文（userId/roleId/isAdmin）并执行双重校验：

- **禁止修改自身所属角色的权限**：非 admin 调用者 `caller.roleId === roleId` 时直接 403，否则可给自己加 `user:role_manage` 完成自提权闭环

- **授予不得超过自身权限集**：非 admin 提交的权限码必须是调用者自身已持有的子集，超出部分 403（防止横向扩散未授权能力）

- **禁止全无效码清空**：提交的权限码全部无效（含全部指向已软删权限）时直接 400 拒绝，否则事务会「删光旧权限、不插新权限」构成无感权限清空攻击；明确传空数组清空仍允许，但**仅超管**（非超管传空数组 403），PUT 已进审计留痕

- 更新使用事务（delete + insert）保证原子性，成功后按 `perm:role:{roleId}` 失效缓存（失败仅告警，权限以 DB 为准，禁止 unhandledRejection 拖垮进程）

### 验证码尝试计数（原子化）

邮箱验证码尝试次数（`register:code:attempts:*`）必须用 Lua 脚本原子执行 INCR + EXPIRE（首次 INCR 时设置 TTL），禁止分两次调用——否则并发下 EXPIRE 丢失会导致计数永驻 Redis。同模式适用于所有"计数 + 过期"场景（限流、错误日志 IP 限额）。

### WebSocket 模块守卫

`websocket.controller` 必须在类级别挂 `@UseGuards(PermissionsGuard)`，并按接口区分鉴权：

- `GET /websocket/online`（暴露在线用户 ID 列表）：必须挂 `@Permissions(NOTIFICATION_VIEW)`，否则任意登录用户可枚举在线用户 ID（信息泄露）

- `POST /websocket/notify`（向指定用户发通知）：必须用 `@CurrentUser()` 取当前用户，并校验 `dto.userId === user.sub`——禁止任何登录用户给任意用户发通知并持久化写入

### WebSocket 连接生命周期

`events.gateway` 的连接管理必须遵守（多实例部署下在线状态存 Redis Set `ws:online:{userId}`）：

- **原子登记**：连接数限制（SCARD 判断）+ SADD + TTL 续期必须用 Lua 脚本一次执行，禁止分步调用（并发下可超限或 key 过期）

- **TTL 续期**：在线状态 key 设 300s TTL，由 60s 定时器持续续期，防止长连接后 key 过期导致推送不可达；连接断开时从 Set 移除，Set 空则删 key

- **定时重校验**：每 60s 校验 `access:{userId}:${jti}` 黑名单（logout/禁用/改角色后 WS 连接必须在 1 个周期内断开）+ 用户状态 + 权限集，任一失效即断开连接。权限集查询口径与 `PermissionsGuard` 一致（`rolePermissions` innerJoin `permissions` 过滤 `notDeleted`），确保 WS 侧权限判断与 HTTP 链路不漂移

- **presence 广播权限过滤**：presence 事件（上线/下线）通过 `presence:watchers` room 定向广播，仅持 `notification:view` 或 admin 的连接加入（`syncPresenceRoom`）；权限变更重校验时动态 join/leave，多实例部署经 Redis adapter 跨实例同步

- **登出即断**：登出仅吊销 HTTP token 不够，WS 侧靠 jti 黑名单重校验兜底断连

- **适配器清理**：`redis-io.adapter` 必须实现 `close()` 断开 pub/sub 连接，避免应用关闭时连接泄漏

### 前端路由守卫

所有需登录的路由必须在 `beforeLoad` 中调用 `requireAuth()`（校验登录标记 + token 存在性，access token 随 Zustand persist 持久化、刷新后直接读取；旧版本遗留的无 token 状态由 `bootstrapAuth` 用 httpOnly cookie 恢复，refresh token 始终只在 httpOnly cookie 中）。权限码校验不放 `beforeLoad`，而由 `AuthenticatedLayout` 在 `useCurrentUser` 加载完成后通过 `getRequiredPermission(pathname)` 统一处理；守卫与菜单的 user 取值必须以 `query.data ?? storeUser`（me 最新返回优先）为准——store 里是 `useEffect` 写入的持久化旧值、落后一拍，直接读 store 会在刚授权/回收权限的刷新窗口按旧值误判（有权限被踢 /403，或反向放行一帧）。`useCurrentUser` 失败时不渲染受保护内容（401/403 已由 axios 拦截器跳转）。`mail`/`dashboard`/`websocket` 等路由不得缺失 `beforeLoad`，否则未登录用户可直接访问页面（虽后端有权限兜底，仍是 UX 问题且放大攻击面）。`/login` 路由对已登录用户重定向到 `/dashboard`，避免重复登录。

### 强制改密链路（三道防线，缺一即弹回登录页）

后端 `AuthGuard` 对 `mustChangePassword=true` 的 token 只放行改密/个人信息/登出三个接口，其余一律 401「请先修改默认密码」。前端必须配套三处处理，否则会出现「登录成功 → 闪一下 → 被踢回 /login」：

1. **登录后按标志分流**：`login.tsx` 读取登录响应的 `user.mustChangePassword`，为 true 时直接 `navigate` 到 `/change-password`，不得统一跳 `/dashboard`
2. **401 拦截器区分语义**：`api.ts` 必须在通用 401 refresh 逻辑**之前**拦截 `message === '请先修改默认密码'` 并跳 `/change-password`。此类 401 表示 token 有效但权限受限，若误走 refresh 分支，`auth.service` 同样拒绝 refresh，最终触发 `logout()` + 跳 `/login`
3. **业务请求下沉到 Layout 内层**：受保护页面的数据 hook 必须写在 `AuthenticatedLayout` 的**子组件**里（如 `DashboardPage` 只渲染 Layout，数据请求放 `DashboardContent`）。React Hook 规则决定外层 hook 必然先于 Layout 内的重定向执行，写在外层会先打出白名单外请求拿到 401

**签发面清单（四入口必须同时携带标志）**：密码登录、refresh、WebSocket 握手、微信登录（`wechat.service`）。前两者读 DB 的 `mustChangePassword`，WS 与 wechat 的 token payload 必须同样带上——任一入口漏带，管理员重置密码后的"封锁至改密"就会在该入口静默失效（M2）。

## 权限控制

### 统一使用 @Permissions + PermissionsGuard

- **禁止使用** **`@Roles('admin')`** **+** **`RolesGuard`**：`@Roles` 只匹配角色名，无法通过权限配置页动态分配

- **必须使用** **`@Permissions('xxx:yyy')`** **+** **`PermissionsGuard`**：权限码格式为 `资源:操作`（如 `user:view`/`error_log:manage`）

- 权限码必须在 `@shared/constants/default-seed.ts` 的 `DEFAULT_PERMISSIONS` 中定义（seed 与 setup 两条初始化路径共用单一来源），controller 中使用的权限码必须与其一致

- `PermissionsGuard` 通过 `getPermissionsByUserId` 查询用户角色的权限码列表进行鉴权

- **`routes` 字段编辑仅限超管**：`PermissionsGuard` 在权限码不足时会兜底匹配所持权限码的 `routes` 白名单，因此 `routes` 是权限码矩阵之外的第二授权面。`permissions.service` 的 create/update 携带 `routes` 时必须校验 `isAdminUser(caller)`，否则持 `permission:update` 的委托管理员可给自己已持有的码追加任意路由实现全站提权

### 权限码命名规范

格式：`{resource}:{action}`

- resource 用 snake\_case（如 `error_log`）

- action 用 `view`/`create`/`update`/`delete`/`manage`/`upload`/`send` 等

## 限流

- `ThrottlerModule` 必须通过 `APP_GUARD` 注册 `ThrottlerGuard` 才能生效

- 限流参数（TTL/limit）必须用环境变量，禁止硬编码

- **计数必须原子化**：Redis 计数 + 首次 EXPIRE 必须用 Lua 脚本一次执行（`redis-throttler.storage`、验证码尝试计数、error-logs IP 日限额同模式），分步调用在进程中断时会产生无 TTL 的永驻 key，导致永久限流

- **邮件每邮箱 60s 限流**：用 `SET NX EX` 原子抢占（`mail.service`），禁止 exists 检查 + 事后标记的两步模式——并发请求会同时通过检查发出多封

- **日配额（L6）**：`POST /schedule/backup` 3 次/日/用户、`POST /files/upload` 100 次/日/用户、`POST /websocket/notify` 50 次/日/用户，超限 409；`common/utils/daily-quota.ts` 按上款 Lua 原子计数（键 `quota:<action>:<uid>:<yyyymmdd>`，TTL 至当日 24:00），cron 每日备份不经此路径

- error-logs 模块查询接口（findAll/stats/grouped/whitelist）与单条详情（`@Get(':id')`）统一 `@Throttle({ default: { limit: 60, ttl: 60000 } })`（L7：原四查询端点 `@SkipThrottle` 零限流，持 `error_log:view` 者可高频打 3 个全表 count + groupBy）
- 登录/注册/发码各为独立的 default 桶（throttler v6 key 含 class-handler-name，不共享计数），limit 读 `THROTTLE_LOGIN_LIMIT`（默认 5/分钟），避免 named 桶污染全部路由（M1/L12）
- **限流旁路必须显式**：仅 e2e/vitest 由测试 setup 设 `ALLOW_THROTTLE_BYPASS=true`，禁止在生产/预发开启（L15：原 `NODE_ENV=test` 隐式旁路已移除）

### 登录失败锁定（J2=A）

- 锁定键为 `login:fail:<ip>:<username>`（取不到 IP 时退化为 `login:fail:<username>`），15 分钟内失败 10 次锁定（`auth.service`）
- 保留 IP + 用户名双维度：单 IP 无法批量锁死全站账号，分布式攻击也无法仅凭用户名全局锁死；J2=A 拍板维持此方案，不引入全局用户名熔断
- 该方案依赖真实客户端 IP：反代部署必须正确设置 `TRUST_PROXY`（M3 已做合法值校验 + 生产启动告警）；漏配时全体请求共享代理 IP，锁定键退化为用户名维度，任意攻击者可零成本锁死 admin。部署检查单已覆盖此项前置条件

## CORS

- CORS origin 必须用白名单数组/函数校验，禁止用单一字符串 `*` 或固定 origin

- 开发环境允许 `http://localhost:3000`，生产环境由 `ALLOW_ORIGIN` 控制，且**生产未配置时启动失败**（M3/L15：原默认值会让跨域前端全量被拒，静默塌缩）

- HTTP（`main.ts`）与 WebSocket（`events.gateway` 装饰器）的 CORS 必须保持一致：同一 `ALLOW_ORIGIN` 来源、同一默认值（`http://localhost:3000`）、拒绝时均用 `callback(null, false)` 不抛异常，避免复用者只配一处导致 HTTP/WS 行为分叉

## XSS 防护

- 全局管道链中 `XssPipe` 位于 `ZodValidationPipe` 之前，对富文本字段做 XSS 清洗

- 用户输入的字段（如 nickname、description）禁止 HTML 原样存储

- **豁免必须用 `@SkipXss()` 装饰器**（DTO 类上标注）：仅限"原文必须如实入库且无渲染面"的字段（错误上报文案、白名单 pattern）——报错文案常含 `<script` 字样，无差别剥 HTML 会失真。豁免清单新增须评审（渲染面 + React 默认转义兜底）

- **HTTP 管道外的入库路径**（如微信昵称/头像）必须手动调用 `common/utils/strip-html.ts` 的 `stripHtml` 同款清洗，保证管道内外口径一致（L19）；头像另需 http(s) URL 校验

- **H6 风险声明（已评估，接受现状）**：accessToken 经 zustand persist 落 `localStorage`，XSS 可直接窃取。接受理由：有效期仅 15 分钟 + refresh 走 httpOnly cookie + `XssPipe`/CSP 纵深；内存方案虽能缩小窃取面，但每次刷新页强制 silent refresh，反而把 reload 可用性押在 refresh 上（cookie 过期即开页登出），且不解决刷新有效性问题（轮换/吊销/cookie 传输在服务端）。若未来威胁模型变化再迁移内存 + silent refresh。

## 账号标识大小写（L20）

- `username`/`email` 在 zod schema 入口统一 `.trim().toLowerCase()`（`UsernameSchema`/`UserEmailSchema`，登录/注册/建户/改邮箱/setup 全覆盖），唯一索引保持原样即等效大小写不敏感

- 存量数据由 `0002_lowercase_identity` 迁移归一；若存在仅大小写不同的活跃账号，迁移会因唯一索引冲突失败——属预期防护，先人工合并再重跑

