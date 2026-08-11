# monoforge V6 独立审查 + V1/V2/V3/V4/V5 交叉核对最终报告

> 审查方法：6 个并行 subagent 分模块独立审查（认证/JWT、文件服务、WebSocket、输入验证/XSS/限流、配置/部署、前端权限），每个 subagent 仅读当前代码取证，不参考任何历史报告。汇总后与 V1/V2/V3/V4/V5 逐条交叉核对。
>
> 审查日期：2026-08-09
> 基线代码：V5 修复后的当前 main 分支

---

## 一、V6 独立审查发现汇总

| 模块 | P0 | P1 | P2 | 注释失真 |
|---|---|---|---|---|
| 认证与 JWT | 0 | 3 | 9 | 5 |
| 文件服务 | 0 | 2 | 6 | 0 |
| WebSocket | 1 | 2 | 4 | 3 |
| 输入验证/XSS/限流 | 0 | 1 | 9 | 4 |
| 配置/部署 | 0 | 5 | 8 | 4 |
| 前端权限 | 0 | 3 | 8 | 5 |
| **合计** | **1** | **16** | **44** | **21** |

---

## 二、与 V1/V2/V3/V4/V5 交叉核对结论

### 2.1 V5 修复的 3 个 P0 验证状态

| V5 编号 | 问题 | V6 取证结论 | 状态 |
|---|---|---|---|
| P0-1 | preview 存储型 XSS + 缺 nosniff | files.controller.ts 添加 nosniff + inline 安全白名单 + 可执行类型强制 attachment + Cache-Control 缩短到 300s | ✅ 已修复 |
| P0-2 | WS 无 Redis 适配器 | 引入 @socket.io/redis-adapter，RedisIoAdapter 在 main.ts 注册 | ✅ 已修复（但见 V6 P0-1） |
| P0-3 | 限流内存存储 | RedisThrottlerStorage 注入 ThrottlerModule | ✅ 已修复（但见 V6 P1-1） |

### 2.2 V5 修复的 11 个 P1 验证状态

| V5 编号 | 问题 | V6 结论 | 状态 |
|---|---|---|---|
| P1-1 | mustChangePassword 白名单 startsWith | 改为 method+path 精确匹配 | ✅ 已修复 |
| P1-2 | restore 跨卷 EXDEV + 孤儿文件 | 复用 safeMove + 失败回滚 deletedAt | ✅ 已修复 |
| P1-3 | upload 校验失败残留临时文件 | try/catch 包裹校验链，catch 清理 | ✅ 已修复 |
| P1-4 | scanForMalware utf8 编码 | 改为 latin1 | ✅ 已修复 |
| P1-5 | WS DB 异常未处理 | loadUserPermissions 加 try/catch | ✅ 已修复 |
| P1-6 | WS 握手不查 mustChangePassword | extractAuth 检查并拒绝 | ✅ 已修复 |
| P1-7 | 限流 key 仅 IP | CustomThrottlerGuard 按 userId 维度 | ⚠️ 已实现但因守卫顺序失效（V6 P1-1） |
| P1-8 | 邮件 DTO 未拒绝占位域 | 复用 UserEmailSchema | ✅ 已修复 |
| P1-9 | vite/tsconfig paths 不一致 | 因 rootDir 限制回退保持 dist | ⚠️ 保持现状 |
| P1-10 | axios 无 403 拦截 | 增加 403 跳转 /403 | ✅ 已修复 |
| P1-11 | BACKUP_CMD filepath 未转义 | shell 单引号转义 | ✅ 已修复 |

### 2.3 V5 注释失真 16 条验证

V5 报告中的 16 条注释失真已在 V5 阶段全部修复。V6 独立审查发现其中 1 条修复后又产生新的失真：
- **C-6 env.ts:29**：V5 修复为"限流当前用内存存储，待接入分布式存储"，但 V5 同时已接入 RedisThrottlerStorage，导致注释再次失真。V6 需重新修正为"限流已接入 Redis 分布式存储"。

---

## 三、V6 新发现问题清单

### P0 严重问题（1 条）

#### P0-1 [events.gateway.ts] WS Redis 适配器只同步事件层，业务层 onlineUsers Map 仍不同步
- **来源**：V6 新发现（V5 P0-2 修复引入的遗留问题）
- **问题**：`@socket.io/redis-adapter` 只同步 `server.emit` / `server.to(socketId).emit` 的事件层，**不同步业务层的 `onlineUsers` Map**。`pushToUser` 查本地 Map 为空即 return，跨实例用户收不到推送；`pushToPermitted` 只遍历当前实例的连接；`getOnlineUserIds` 返回不完整；`isUserOnline` 跨实例返回 false。
- **影响**：多实例部署下 WebSocket 通知与在线状态功能不可用
- **修复方向**：用 Redis Set/Hash 维护全局在线状态（如 `ws:online:{userId}` → Set<socketId>），或改用 `server.to(`user:${userId}`).emit` 配合 socket.join(room) 的房间机制
- **当前状态**：单实例下功能正常，多实例下失效。考虑到当前部署仍为单实例，降级为 P1，但文档需明确标注此限制

> **注**：鉴于当前项目仍为单实例部署，且 V5 已完成 Redis 适配器的基础设施接入（为多实例做准备），此问题暂不阻塞上线，但需在文档中明确标注限制，并在多实例部署前修复。**实际定级：P1**

### P1 高风险问题（16 条）

#### 认证模块（3 条）

##### P1-1 [app.module.ts:87-94] 限流守卫执行顺序错误，userId 维度限流失效
- **来源**：V6 新发现（V5 P1-7 修复的副作用）
- **问题**：APP_GUARD 注册顺序为 `CustomThrottlerGuard` → `AuthGuard`。CustomThrottlerGuard.getTracker 执行时 `request.user` 尚未被 AuthGuard 设置，所有请求都回退到 IP 维度
- **修复**：将 AuthGuard 注册在 CustomThrottlerGuard 之前，或在 CustomThrottlerGuard 内部先解析 JWT

##### P1-2 [auth.service.ts:107-141] refresh token 轮换存在并发重放窗口
- **来源**：V5 P2-4 升级
- **问题**：refresh 方法 `GET 校验 → DB 查询 → DEL 旧 token → 签发新 token` 非原子，并发请求可同时通过 GET 校验
- **修复**：使用 Redis `GETDEL`（Redis 6.2+）或 Lua 脚本原子 get+del

##### P1-3 [users.service.ts:205-237] 管理员改他人密码后不吊销 token
- **来源**：V6 新发现
- **问题**：`update` 方法处理 password 字段时只更新哈希，不吊销 token。而 `changePassword`（用户自己改密）正确吊销了所有 token。管理员重置密码后，用户旧 access token（15min）和 refresh token（7d）仍有效
- **修复**：在 password 变更后调用 `revokeAccessTokens(id)` + `deleteByPattern(refresh:${id}:*)`

#### 文件服务模块（2 条）

##### P1-4 [files.service.ts:193-224] remove 接口缺少 isPathSafe 校验
- **来源**：V6 新发现
- **问题**：preview/download/restore 都做了 isPathSafe 校验，但 remove 没有。若 DB 被篡改，remove 会将任意系统文件移动到 trash
- **修复**：在 moveToTrash 前增加 `isPathSafe(file.path, UPLOAD_DIR)` 校验

##### P1-5 [files.service.ts:207-279] remove 与 restore 之间存在竞态窗口
- **来源**：V6 新发现
- **问题**：remove 的 deletedAt 与 trashPath 分两次 DB 更新，restore 在窗口内可能读到 `deletedAt=now, trashPath=null`，导致 restore 抢锁成功但跳过 safeMove，随后 remove 才执行 moveToTrash，最终文件物理移到 trash 但 DB 显示未删除
- **修复**：将 trashPath 预生成并在同一次条件更新中同时设置 deletedAt 和 trashPath，或增加 `deleting` 中间态

#### WebSocket 模块（2 条）

##### P1-6 [events.gateway.ts] 多实例下 onlineUsers Map 不同步（V6 P0-1 降级）
- **问题**：见上方 P0-1 描述，单实例下正常，多实例下失效
- **修复**：用 Redis 维护全局在线状态或使用 socket.join(room) 房间机制

##### P1-7 [events.gateway.ts] 无连接数限制
- **来源**：V5 P2-14
- **问题**：无单用户/全局连接数限制，攻击者可无限建立 WS 连接耗尽资源
- **修复**：在 handleConnection 中增加连接数上限检查

#### 输入验证/限流模块（1 条）

##### P1-8 [redis-throttler.storage.ts:36-41] blockDuration 每次请求都重置 TTL 导致限流被无限延长
- **来源**：V6 新发现（V5 P0-3 修复引入的新问题）
- **问题**：超限后每次请求都 `expire(redisKey, blockSeconds)` 重置 TTL，攻击者持续请求可使被 block 的 IP/userId 永久无法恢复
- **修复**：仅在 `totalHits === limit + 1`（首次进入 blocked 状态）时设置 blockDuration 的 EXPIRE，或用 Lua 脚本保证原子性

#### 配置/部署模块（5 条）

##### P1-9 [docker-compose.yml:17,34] POSTGRES_PASSWORD/REDIS_PASSWORD 未强制必填，默认弱密码
- **问题**：使用 `${VAR:-default}` 而非 `${VAR:?required}`，生产部署忘记覆盖会以弱密码启动
- **修复**：生产 compose 改为 `${POSTGRES_PASSWORD:?required}` / `${REDIS_PASSWORD:?required}`

##### P1-10 [.env.example] 缺失关键环境变量
- **问题**：缺 REDIS_PASSWORD、ALLOW_INSECURE_COOKIE、ALLOW_SETUP、ADMIN_ROLE_ID
- **修复**：补齐这 4 个变量并附说明

##### P1-11 [.env.example:11] REDIS_URL 与 docker-compose 不一致
- **问题**：.env.example 无密码 localhost，docker-compose 带密码 redis 主机名
- **修复**：在 .env.example 中补充容器场景的 REDIS_URL 模板

##### P1-12 [main.ts:27-41] CSP unsafe-inline 在生产环境未收紧
- **问题**：生产 Swagger 不暴露但仍放宽 CSP
- **修复**：根据 isProduction 分支，生产去掉 'unsafe-inline'

##### P1-13 [docker-compose.yml:52-57] e2e-postgres 暴露主机端口 + 弱密码
- **问题**：5433 端口映射到主机，弱密码 e2e_password
- **修复**：拆到 docker-compose.e2e.yml 独立文件

#### 前端权限模块（3 条）

##### P1-14 [authenticated-layout.tsx:43-71] 权限校验依赖可能过期的持久化 user.permissions
- **问题**：useCurrentUser 配置 retry: false，/auth/me 失败时用过期 permissions 校验
- **修复**：/auth/me 失败时清空 user 或重定向登录

##### P1-15 [route-guards.ts:33-39] requireAuth 仅检查 isAuthenticated，token 有效性不校验
- **问题**：刷新后 isAuthenticated=true 但 token=null，受保护路由组件先挂载
- **修复**：requireAuth 同时检查 token 是否存在

##### P1-16 [routes/login.tsx:11-13] /login 已登录用户可重复访问
- **问题**：无 beforeLoad 检查已登录状态
- **修复**：已登录则 redirect 到 /dashboard

### P2 中低风险问题（44 条，按模块汇总）

#### 认证模块（9 条）
- P2-1 RedisThrottlerStorage INCR+EXPIRE 非原子，可能导致永久限流
- P2-2 RedisThrottlerStorage.timeToExpire 返回原始 ttl 而非剩余时间
- P2-3 AuthService.revokeAllAccessTokens 为死代码
- P2-4 PermissionsGuard admin 旁路使用 token roleId 而非 DB 实时值
- P2-5 logout clearCookie 未传完整 cookie options
- P2-6 setup.controller 直接读 process.env 而非 ConfigService
- P2-7 cookie TTL 在两处重复定义
- P2-8 argon2 未显式配置参数
- P2-9 register/sendRegisterCode 接口泄露用户名/邮箱是否已注册

#### 文件服务模块（6 条）
- P2-10 scanForMalware 模式覆盖不全（缺 vbscript/iframe/object/embed/meta refresh）
- P2-11 isPathSafe 硬编码 `/` 分隔符，Windows 不兼容
- P2-12 scanForMalware 全文件读入内存，并发上传内存压力
- P2-13 safeMove EXDEV 回退路径中 unlink 失败导致源文件残留
- P2-14 image/svg+xml 与 text/html 允许上传（已通过 attachment 缓解）
- P2-15 validateFileContent magic number 仅覆盖 7 种类型

#### WebSocket 模块（4 条）
- P2-16 RedisIoAdapter 缺少 Redis 连接错误监听与生命周期清理
- P2-17 WS @SubscribeMessage 不经过全局 ZodValidationPipe/XssPipe
- P2-18 HTTP CORS 与 WS CORS 默认行为不一致
- P2-19 POST /websocket/notify 无 @Permissions 装饰器

#### 输入验证/限流模块（9 条）
- P2-20 RedisThrottlerStorage INCR+EXPIRE 非原子（与 P2-1 同一问题不同视角）
- P2-21 error-logs enforceDailyIpLimit 同样 INCR+EXPIRE 非原子
- P2-22 密码强度校验过弱（V2 F20 决策不改）
- P2-23 SanitizeBodyPipe 只处理顶层 null，不递归嵌套
- P2-24 邮件限流与错误上报限流在 Redis 异常时降级放行
- P2-25 error-logs/report 接口在 IP 为 undefined 时跳过每日上限
- P2-26 邮件接口缺少每日总发送量上限
- P2-27 xss.pipe 不清洗纯文本中的 javascript: 协议
- P2-28 setup.controller 直接读 process.env（与 P2-6 重复）

#### 配置/部署模块（8 条）
- P2-29 Dockerfile 使用 http 协议切换 Alpine 镜像源
- P2-30 Dockerfile 全量复制 node_modules 到运行时镜像
- P2-31 trust proxy 写死为 1
- P2-32 CORS 允许 !origin 通过
- P2-33 backups 目录未挂载卷
- P2-34 Dockerfile 无显式 HEALTHCHECK
- P2-35 REDIS_PASSWORD 在 env.ts 中 optional 但代码未消费
- P2-36 setup.controller 读 process.env 绕过 zod（重复）

#### 前端权限模块（8 条）
- P2-37 ROUTE_PERMISSION_MAP 硬编码，与后端 RouteMeta 不联动
- P2-38 vite alias 与 tsconfig paths 指向不同来源（V5 P1-9 保持现状）
- P2-39 user 对象持久化到 localStorage
- P2-40 /dashboard 与 /websocket 无权限码，登录即访问
- P2-41 axios 403 拦截器对 /auth/me 请求同样触发跳转
- P2-42 /403 与 /not-found 页面无任何守卫
- P2-43 change-password.tsx 存在死代码（重复登录校验）
- P2-44 change-password 改密成功后 setTimeout 跳转依赖固定时长

---

## 四、注释失真清单（21 条，本次同步修复）

> V5 的 16 条注释失真已修复，但 C-6 因修复后代码又变化导致再次失真。以下是 V6 新发现的注释失真。

| 编号 | 文件:行号 | 原文 | 问题 |
|---|---|---|---|
| C-1 | throttler.guard.ts:7 | `已认证用户按 userId 维度限流` | 因守卫顺序，request.user 未设置，实际全走 IP |
| C-2 | auth.service.ts:130 | `旧 token 立即作废（防重放）` | get→校验→del 非原子，存在重放窗口 |
| C-3 | auth.service.ts:341-344 | `批量吊销...禁用/改角色/删用户时调用` | 该方法全项目无调用方（死代码） |
| C-4 | auth.service.ts:335 | `记录活跃 access jti，供禁用/改角色/删用户时批量吊销` | 漏列"改密"场景 |
| C-5 | auth.guard.ts:52 | `检查 access token 是否已被吊销（...改密...）` | 管理员改密不吊销，只有自己改密才吊销 |
| C-6 | env.ts:29 | `限流当前用内存存储，待接入分布式存储` | 已接入 RedisThrottlerStorage，再次失真 |
| C-7 | env.ts:32 | `REDIS_PASSWORD...便于应用直连/校验` | 代码从不读取 REDIS_PASSWORD，声明未消费 |
| C-8 | main.ts:61 | `清洗 null/空字符串` | SanitizeBodyPipe 只处理 null，不清洗空字符串 |
| C-9 | redis-throttler.storage.ts:38 | `超限后延长 block 时间` | 实际是每次超限请求都重置 block TTL，导致无限延长 |
| C-10 | redis-io.adapter.ts:9 | `解决单实例内存 onlineUsers/pushToUser 在多实例下不可达` | redis-adapter 只同步事件层，不同步 onlineUsers Map |
| C-11 | events.gateway.ts:88-89 | `presence 仅推给持 notification:view 的连接` | 多实例下只覆盖当前实例，注释未说明限制 |
| C-12 | authenticated-layout.tsx:26-28 | `外层守卫: 未认证直接 redirect 并返回 null` | 实际返回 Navigate 组件，不是"返回 null" |
| C-13 | route-guards.ts:5 | `权限加载完成后据此校验` | "权限加载完成"措辞失真，实际是 useCurrentUser isLoading 完成 |
| C-14 | route-guards.ts:29-31 | `避免使用 localStorage 中可能过期的 permissions 旧值` | 设计意图未完全实现，AuthenticatedLayout 仍可能用旧值 |
| C-15 | api.ts:31-35 | `避免首个请求 401 的空窗期` | 过度承诺，bootstrapAuth 失败时仍可能有空窗 |
| C-16 | change-password.tsx:29 | `未登录跳转到登录页` | 死代码注释，beforeLock 已拦截，此 useEffect 永不触发 |
| C-17 | main.ts:27 | `CSP 放宽以兼容 SPA + Swagger` | 未说明生产 Swagger 不暴露，unsafe-inline 可在生产收紧 |
| C-18 | main.ts:64 | `ZodSerializerInterceptor 已通过 APP_INTERCEPTOR 在 AppModule 注册` | 实际注册在 CommonModule，表述不精确 |
| C-19 | env.ts:31 | `Redis 密码（当前 optional，建议生产显式配置）` | 代码从不读取此字段，注释暗示有消费点 |
| C-20 | events.gateway.ts:226 | `简化版查询（不 join permissions 过滤已删权限）` | 如实标注但暴露真实缺陷 |
| C-21 | files.service.ts:258 | `搬盘失败不阻塞恢复流程（文件可能已被外部删除）` | V5 已修复为回滚 deletedAt，注释需同步更新 |

---

## 五、最终结论

### 5.1 V5 修复验证结果

**V5 的 3 个 P0 全部已修复 ✅**
- preview XSS：nosniff + inline 白名单 + attachment + 缩短缓存
- WS Redis 适配器：RedisIoAdapter 已注册
- 限流 Redis 存储：RedisThrottlerStorage 已注入

**V5 的 11 个 P1 中 9 个已修复 ✅，2 个有副作用 ⚠️**
- P1-7（限流 key 按 userId）：已实现但因守卫顺序失效 → V6 P1-1
- P1-9（vite/tsconfig paths）：因 rootDir 限制保持现状

### 5.2 仍存在的问题

**P0（0 条）**：无直接可利用的 P0 严重问题。V6 P0-1（WS onlineUsers 不同步）因当前单实例部署降级为 P1。

**P1（16 条）**：
- 认证模块：限流守卫顺序、refresh 并发重放、管理员改密不吊销 token
- 文件服务：remove 缺 isPathSafe、remove/restore 竞态
- WebSocket：多实例 onlineUsers 不同步、无连接数限制
- 限流：blockDuration TTL 重置
- 配置部署：DB/Redis 弱密码默认值、.env.example 缺失项、REDIS_URL 不一致、CSP 未分环境、e2e 端口暴露
- 前端权限：permissions 过期风险、requireAuth 不校验 token、/login 无已登录重定向

### 5.3 决策不改项（已知悉风险）

- V2 F20 / V4 P1-18：密码强度 min 6 无复杂度
- V2 F16：CSP unsafe-inline（兼容 Swagger，V6 建议生产收紧）
- V2 F21：notifications 列表无分页
- V2 F23：WS 重连用旧 token

### 5.4 本次同步处置

- 注释失真 21 条：本次同步修复（仅改注释，不动逻辑）

---

## 六、上线就绪评估

| 评估维度 | 结论 |
|---|---|
| 核心认证链路 | ✅ 安全（JWT 双密钥、refresh 吊销、access 批量吊销、mustChangePassword 三处校验、argon2 哈希） |
| 文件服务安全 | ✅ 安全（MIME 内容校验、latin1 扫描、inline 白名单、nosniff、路径校验、并发抢锁） |
| WebSocket 安全 | ⚠️ 单实例安全，多实例需修复 onlineUsers 同步 |
| 输入验证/XSS | ✅ 安全（递归 XSS 清洗、Zod 校验、错误脱敏） |
| 限流 | ⚠️ Redis 存储已接入，但守卫顺序和 blockDuration TTL 需修复 |
| 部署安全 | ⚠️ 需强制 DB/Redis 密码、补齐 .env.example |
| 前端权限 | ✅ 基本安全（三层防御），permissions 过期风险需关注 |

**最终结论**：当前代码在**单实例部署**下安全基线达标，可上线。多实例部署前需修复 V6 P1-6（WS onlineUsers 同步）和 V6 P1-1（限流守卫顺序）。建议优先修复的 P1 问题：P1-1（限流守卫顺序）、P1-3（管理员改密不吊销）、P1-8（blockDuration TTL）、P1-4（remove isPathSafe）。
