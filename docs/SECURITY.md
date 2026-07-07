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

### Cookie 安全

- `secure` flag 必须由环境变量控制，不能硬编码 `true`/`false`
- `sameSite` 必须为 `Strict` 或 `Lax`（不允许 `None` 除非有明确跨站需求）

### 请求体校验

- 所有请求体必须经 Zod 校验管道，禁止裸传对象，防止 SQL 注入和字段污染
- 全局管道链：`SanitizeBodyPipe → ZodValidationPipe → XssPipe`

## 初始管理员保护

- **初始管理员账号（`username === 'admin'`）不可删除**
- 前端：删除按钮 `disabled`，Popconfirm 禁用并提示「初始管理员账号不可删除」
- 后端：`users.service.remove` 二次校验 `if (existingUser.username === 'admin') throw new ConflictException(ErrorMessages[ErrorCodes.INITIAL_ADMIN_CANNOT_DELETE])`

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

- 仅 admin 用户或原始上传者可删除文件

## 限流

- `ThrottlerModule` 必须通过 `APP_GUARD` 注册 `ThrottlerGuard` 才能生效
- 限流参数（TTL/limit）必须用环境变量，禁止硬编码
- error-logs 模块的只读接口（findAll/stats/grouped/whitelist）必须 `@SkipThrottle()`，避免 429

## CORS

- CORS origin 必须用白名单数组/函数校验，禁止用单一字符串 `*` 或固定 origin
- 开发环境允许 `http://localhost:3000`，生产环境由 `ALLOW_ORIGIN` 控制

## XSS 防护

- 全局管道链末端为 `XssPipe`，对富文本字段做 XSS 清洗
- 用户输入的字段（如 nickname、description）禁止 HTML 原样存储
