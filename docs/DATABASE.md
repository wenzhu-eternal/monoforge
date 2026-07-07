# 数据库规范

## 表结构铁律

1. **禁止 `synchronize`** - 所有表结构变更走 `drizzle-kit generate` 迁移
2. **表名使用 snake_case 复数** - `users` / `roles` / `error_logs`
3. **使用 PostgreSQL** - JSONB 存可变结构
4. **软删除** - 所有业务表添加 `deleted_at` 字段，删除操作仅设置时间戳，查询时过滤 `deleted_at IS NULL`；审计日志（`audit_logs`）等 append-only 表例外
5. **部分唯一索引** - 唯一字段（username/email/role.name/permission.code）必须用 `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`，禁止使用列级 `.unique()`。原因：列级 unique 会阻止软删后同名重建
6. **唯一约束冲突兜底** - service 层 `create` 方法必须 `try/catch` 包裹 `db.insert`，捕获 23505 错误码转 `ConflictException`，防止 TOCTOU 竞态（先查询再插入之间被并发插入）
7. **删除前外键校验** - 删除实体前必须检查未软删的外键引用（如 `users.roleId` → `roles`，`rolePermissions.roleId` → `roles`），存在引用则抛 `ConflictException`

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

### `notDeleted(deletedAt)` 仅传单列

正确用法 `and(eq(col, val), notDeleted(deletedAt))`；错误用法 `notDeleted(id, deletedAt)` 会把所有传入列都判 `IS NULL` → 永远查不到记录。

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
