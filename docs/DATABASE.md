# 数据库规范

## 表结构铁律

1. **禁止 `synchronize`** - 所有表结构变更走 `drizzle-kit generate` 迁移
2. **表名使用 snake_case 复数** - `users` / `roles` / `error_logs`
3. **使用 PostgreSQL** - JSONB 存可变结构
4. **软删除** - 所有业务表添加 `deleted_at` 字段，删除操作仅设置时间戳，查询时过滤 `deleted_at IS NULL`；审计日志（`audit_logs`）等 append-only 表例外。注意：`files` 表软删仅标记 DB 记录，不删除磁盘文件（已"删除"文件仍可凭 URL 访问），敏感上传场景需额外评估磁盘清理策略
5. **部分唯一索引** - 唯一字段（username/email/wechatOpenId/role.name/permission.code）必须用 `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`，禁止使用列级 `.unique()`。原因：列级 unique 会阻止软删后同名重建
6. **外键引用列用 `integer` 不用 `serial`** - `serial` 会创建多余的自增序列且无外键约束，引用列（如 `audit_logs.user_id` / `error_logs.user_id`）必须用 `integer`。可空的外键引用列不加 `.notNull()`（如 `error_logs.user_id` 允许未登录用户上报错误）
7. **唯一约束冲突兜底** - service 层 `create` 方法必须 `try/catch` 包裹 `db.insert`，捕获 23505 错误码转 `ConflictException`，防止 TOCTOU 竞态（先查询再插入之间被并发插入）
8. **删除前外键校验** - 删除实体前必须检查未软删的外键引用（如 `users.roleId` → `roles`，`rolePermissions.roleId` → `roles`），存在引用则抛 `ConflictException`

## 软删除过滤铁律

> 来源：2026-07 会话中审计发现 27 处查询缺 `notDeleted` 过滤，其中 `auth.service` login 缺过滤导致「已删除用户可登录」高危漏洞。

1. **所有 `findFirst` / `findMany` / `count` 必须加 `notDeleted(deletedAt)`** - 包括 findById/findAll/getStats/duplicateEmail 检查等
2. **`leftJoin` / `innerJoin` 的表也要加 `notDeleted`** - 否则会返回引用已软删数据的「幽灵记录」（如 rolePermissions join permissions 时缺过滤会返回幽灵权限码）
3. **`update` 前的 `findFirst` 也要过滤** - 防止更新已软删记录
4. **`remove` 前的 `findFirst` 也要过滤** - 防止重复软删
5. **认证链路高危**：`auth.service` 的 login/refresh/getProfile/register/getPermissionsByUserId/getRoleByUserId 全部必须过滤，已删除用户不得登录、不得刷新 token、不得占用用户名/邮箱注册
6. **统计查询必须过滤**：`getStats` 的 total/active count 不加过滤会把已删用户算进去
7. **删除操作必须软删**：禁止 `db.delete()` 硬删（`notifications.service.remove` 曾违反此约定，已修复）
8. **模范实现**：`roles.service.ts` 与 `files.service.ts` 全部正确，新增 service 时以此为模板

## helpers 规范

### `notDeleted(deletedAt)` 仅接受单列

签名 `notDeleted(column: Column)` 已收紧为单参数，编译期即阻止多列误用。正确用法 `and(eq(col, val), notDeleted(deletedAt))`。

### `isUniqueViolation(error)`

service 层 create/update 包裹 db 操作时必须用此 helper 判断 23505 错误码，转 `ConflictException`：

```ts
import { isUniqueViolation } from '@/db/helpers'
import { ConflictException } from '@nestjs/common'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'

try {
  await db.insert(users).values(data)
} catch (error) {
  if (isUniqueViolation(error)) {
    throw new ConflictException(ErrorMessages[ErrorCodes.USER_ALREADY_EXISTS])
  }
  throw error
}
```

### 删除绑定校验

删除实体前必须检查外键引用（如 `rolePermissions` / `users.roleId`），存在未软删的引用则抛 `ConflictException`。

## 迁移规范

- 表结构变更必须 `pnpm db:generate` 生成迁移文件，禁止手写 SQL 改表
- 迁移文件一旦提交不可修改，新增变更生成新迁移
- 部分唯一索引用 `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`，不用列级 `.unique()`
