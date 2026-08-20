# 安全规范

## 认证链路

### 软删除过滤（高危）

`auth.service` 的所有用户查询必须加 `notDeleted(users.deletedAt)`：

- **login** - 已删除用户不得登录
- **refresh** - 已删除用户的 refresh token 不得刷新
- **getProfile** - 已删除用户不得获取自身 profile
- **register** - 已删除用户名/邮箱不得占用注册（否则同名永远无法重建）
- **getPermissionsByUserId / getRoleByUserId** - 中间步骤也要过滤

`wechat.service.findOrCreateUser` 的 `findFirst` 必须加 `notDeleted(users.deletedAt)`，否则已删除的微信用户扫码后会复活旧账号。

`getRoleByUserId` 查询 role 时必须加 `notDeleted(roles.deletedAt)`，已删除角色的权限不得生效。

### JWT 双 Token 机制

| Token | 有效期 | 存储位置 | 用途 |
|---|---|---|---|
| access_token | 15 分钟 | Authorization Header | API 认证 |
| refresh_token | 7 天 | HttpOnly Cookie + Redis | 刷新 access_token |

- refresh_token 使用 HttpOnly + Secure + SameSite=Strict Cookie
- 密码用 argon2id 哈希
- Refresh Token 在 Redis 中存储，支持多设备登录与强制登出
- 刷新流程：旧 refresh 验证 → Redis 删除旧 refresh → 签发新 access + refresh → 新 refresh 存 Redis（轮换）
- **登出批量吊销**：logout 删除 Redis 中全部 refresh（`refresh:{userId}:*`）外，还必须 `revokeAllAccessTokens`——扫描 `access:active:{userId}:*` 活跃索引，逐个把 jti 写入 `access:{userId}:{jti}` 黑名单（TTL = access 剩余有效期），再删除索引。仅吊销当前请求的 token 会放行其他设备的活跃 access token

### 密码策略

- `PasswordSchema`（注册/创建用户/重置密码）：至少 8 位且必须同时包含字母和数字
- `LoginSchema` 单独宽松化（仅非空校验）：历史弱密码用户仍可登录，配合 `mustChangePassword` 标记走强制改密流程，避免升级策略后存量用户被锁死

### Cookie 安全

- `secure` flag 必须由环境变量控制，不能硬编码 `true`/`false`
- `sameSite` 必须为 `Strict` 或 `Lax`（不允许 `None` 除非有明确跨站需求）

### 请求体校验

- 所有请求体必须经 Zod 校验管道，禁止裸传对象，防止 SQL 注入和字段污染
- 全局管道链：`SanitizeBodyPipe → ZodValidationPipe → XssPipe`

## 初始管理员保护

- **ADMIN_ROLE_ID 匹配的用户不可删除**（基于 `user.roleId === ADMIN_ROLE_ID`，env 默认 1）
- 前端：删除按钮 `disabled`，Popconfirm 禁用并提示「初始管理员账号不可删除」
- 后端：`users.service.remove` 二次校验 `if (isAdminUser(existingUser)) throw new ConflictException(ErrorMessages[ErrorCodes.INITIAL_ADMIN_CANNOT_DELETE])`

## 文件上传安全

多重安全检查（顺序执行，任一失败即拒绝）：

1. **magic number 校验** - 验证文件头真实类型，防止伪装扩展名
2. **恶意内容扫描** - 检查文件内容是否含恶意代码
3. **路径遍历防护** - 文件名清洗，禁止 `..`、`/`、`\` 等路径字符
4. **扩展名黑名单** - 禁止 `.exe`/`.bat`/`.sh`/`.php` 等可执行扩展名
5. **大小限制** - 单文件最大 10MB
6. **MIME 白名单** - 仅允许图片/文档等安全类型
7. **扩展名白名单** - 与 MIME 白名单联合校验

### 文件存储

- 本地磁盘存储（`uploads/` 目录）
- 文件名清洗 + 随机化（防止覆盖和遍历）
- DB schema：`id, filename (disk name), originalName, mimeType, size, path, uploadedBy (userId), createdAt`

### 文件删除权限

- 仅管理员（`isAdminUser`）或原始上传者可删除文件
- **软删时磁盘文件必须移到隔离目录**：`files.service.remove` 在 `set({ deletedAt })` 前调用 `moveToTrash(filePath, filename)`，将文件 `rename` 到 `uploads-trash/{timestamp}-{filename}`。静态托管中间件只服务 `uploads/`，不服务 `uploads-trash/`，避免"已删文件仍可凭 URL 访问"的隐私泄露。`rename` 失败仅告警不阻断软删（DB 记录仍标记删除），保证业务可用性

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

`users.service.hasPermission(userId, permissionCode)` 通过 `rolePermissions` 表查询用户角色是否拥有指定权限码；ADMIN_ROLE_ID 匹配的用户（`isAdminUser`）短路返回 `true`。

### 角色权限更新（防自提权）

`role-permissions.service.updateRolePermissions` 必须接收调用者上下文（userId/roleId/isAdmin）并执行双重校验：

- **禁止修改自身所属角色的权限**：非 admin 调用者 `caller.roleId === roleId` 时直接 403，否则可给自己加 `user:role_manage` 完成自提权闭环
- **授予不得超过自身权限集**：非 admin 提交的权限码必须是调用者自身已持有的子集，超出部分 403（防止横向扩散未授权能力）
- 更新使用事务（delete + insert）保证原子性，成功后按 `perm:role:{roleId}` 失效缓存

### 验证码尝试计数（原子化）

邮箱验证码尝试次数（`verify_code:attempts:*`）必须用 Lua 脚本原子执行 INCR + EXPIRE（首次 INCR 时设置 TTL），禁止分两次调用——否则并发下 EXPIRE 丢失会导致计数永驻 Redis。同模式适用于所有"计数 + 过期"场景（限流、错误日志 IP 限额）。

### WebSocket 模块守卫

`websocket.controller` 必须在类级别挂 `@UseGuards(PermissionsGuard)`，并按接口区分鉴权：

- `GET /websocket/online`（暴露在线用户 ID 列表）：必须挂 `@Permissions(NOTIFICATION_VIEW)`，否则任意登录用户可枚举在线用户 ID（信息泄露）
- `POST /websocket/notify`（向指定用户发通知）：必须用 `@CurrentUser()` 取当前用户，并校验 `dto.userId === user.sub`——禁止任何登录用户给任意用户发通知并持久化写入

### WebSocket 连接生命周期

`events.gateway` 的连接管理必须遵守（多实例部署下在线状态存 Redis Set `ws:online:{userId}`）：

- **原子登记**：连接数限制（SCARD 判断）+ SADD + TTL 续期必须用 Lua 脚本一次执行，禁止分步调用（并发下可超限或 key 过期）
- **TTL 续期**：在线状态 key 设 300s TTL，由 60s 定时器持续续期，防止长连接后 key 过期导致推送不可达；连接断开时从 Set 移除，Set 空则删 key
- **定时重校验**：每 60s 校验 `access:{userId}:{jti}` 黑名单（logout/禁用/改角色后 WS 连接必须在 1 个周期内断开）+ 用户状态 + 权限集，任一失效即断开连接
- **presence 广播权限过滤**：presence 事件（上线/下线）通过 `presence:watchers` room 定向广播，仅持 `notification:view` 或 admin 的连接加入（`syncPresenceRoom`）；权限变更重校验时动态 join/leave，多实例部署经 Redis adapter 跨实例同步
- **登出即断**：登出仅吊销 HTTP token 不够，WS 侧靠 jti 黑名单重校验兜底断连
- **适配器清理**：`redis-io.adapter` 必须实现 `close()` 断开 pub/sub 连接，避免应用关闭时连接泄漏

### 前端路由守卫

所有需登录的路由必须在 `beforeLoad` 中调用 `requireAuth()`（校验登录标记 + token 存在性，token 不持久化、刷新后由 `bootstrapAuth` 用 httpOnly cookie 恢复）。权限码校验不放 `beforeLoad`，而由 `AuthenticatedLayout` 在 `useCurrentUser` 加载完成后通过 `getRequiredPermission(pathname)` 统一处理，避免使用 localStorage 中可能过期的 permissions 旧值导致首屏误 redirect。`useCurrentUser` 失败时不渲染受保护内容（401/403 已由 axios 拦截器跳转）。`mail`/`dashboard`/`websocket` 等路由不得缺失 `beforeLoad`，否则未登录用户可直接访问页面（虽后端有权限兜底，仍是 UX 问题且放大攻击面）。`/login` 路由对已登录用户重定向到 `/dashboard`，避免重复登录。

## 权限控制

### 统一使用 @Permissions + PermissionsGuard

- **禁止使用 `@Roles('admin')` + `RolesGuard`**：`@Roles` 只匹配角色名，无法通过权限配置页动态分配
- **必须使用 `@Permissions('xxx:yyy')` + `PermissionsGuard`**：权限码格式为 `资源:操作`（如 `user:view`/`error_log:manage`）
- 权限码必须在 `seed.ts` 的 `defaultPermissions` 中定义，controller 中使用的权限码必须与 seed 一致
- `PermissionsGuard` 通过 `getPermissionsByUserId` 查询用户角色的权限码列表进行鉴权

### 权限码命名规范

格式：`{resource}:{action}`

- resource 用 snake_case（如 `error_log`）
- action 用 `view`/`create`/`update`/`delete`/`manage`/`upload`/`send` 等

## 限流

- `ThrottlerModule` 必须通过 `APP_GUARD` 注册 `ThrottlerGuard` 才能生效
- 限流参数（TTL/limit）必须用环境变量，禁止硬编码
- **计数必须原子化**：Redis 计数 + 首次 EXPIRE 必须用 Lua 脚本一次执行（`redis-throttler.storage`、验证码尝试计数、error-logs IP 日限额同模式），分步调用在进程中断时会产生无 TTL 的永驻 key，导致永久限流
- **邮件每邮箱 60s 限流**：用 `SET NX EX` 原子抢占（`mail.service`），禁止 exists 检查 + 事后标记的两步模式——并发请求会同时通过检查发出多封
- error-logs 模块的只读接口（findAll/stats/grouped/whitelist）必须 `@SkipThrottle()`，避免 429
- 单条查询接口（如 `@Get(':id')`）用 `@Throttle({ default: { limit: 60, ttl: 60000 } })` 放大限流（60 次/分钟），避免高频查详情被 429

## CORS

- CORS origin 必须用白名单数组/函数校验，禁止用单一字符串 `*` 或固定 origin
- 开发环境允许 `http://localhost:3000`，生产环境由 `ALLOW_ORIGIN` 控制

## XSS 防护

- 全局管道链末端为 `XssPipe`，对富文本字段做 XSS 清洗
- 用户输入的字段（如 nickname、description）禁止 HTML 原样存储
