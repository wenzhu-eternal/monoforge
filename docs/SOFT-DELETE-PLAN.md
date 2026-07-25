# 软删除整体方案

> 本方案由 AI 助手整理，供复查使用。
> 版本：v2（分层策略，替代 v1「一刀切软删」方案）

## 一、核心原则

1. **按表分层**：不同语义的表采用不同删除策略，不强行套用同一种模式。
2. **`deleted_at` = 软删禁用**（有值=已删除，null=正常），仅用于核心实体。
3. **状态位 ≠ 删除**：`status`/`isActive` 表示「业务启停」，与 `deleted_at`「逻辑删除」是两个维度，并存不合并。
4. **可恢复**（仅核心实体）：软删记录可恢复，恢复需处理唯一性冲突。
5. **管理员可见**：管理员可查看含软删记录在内的全部数据；普通用户仅见正常记录。
6. **物理删除**仅用于多对多关联表（`role_permissions`）；通知与日志类用软删归档但不提供恢复。

## 二、分层策略总表

| 表名 | 策略 | 删除操作 | 恢复操作 | 管理员可见 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **users** | 软删(A) | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ | 保留 `status` 业务启停列；恢复需校验 username/email 唯一 |
| **roles** | 软删(A) | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ | 软删时不动关联表；权限查询按 role 软删过滤 |
| **permissions** | 软删(A) | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ | 已有 partial unique index on code |
| **files** | 软删(A) | `deleted_at = NOW()` + 移磁盘文件到隔离目录 | `deleted_at = NULL` + 移回原位 | ✅ | 需新增 `trash_path` 字段记录隔离路径 |
| **error_logs** | 软删归档(A) | `deleted_at = NOW()` | ❌ 不提供恢复 | ✅ | 字段已存在；日志类无恢复价值，软删仅作归档隔离 |
| **error_whitelist** | 软删(A)+ 启停(B) | `deleted_at = NOW()`（删除）/ `is_active=false`（停用） | `deleted_at = NULL` | ✅ | 与 users 同构：`deleted_at` 删除维度 + `is_active` 启停维度并存，维持现状不改 schema |
| **role_permissions** | 物理删(C) | `DELETE` 行 | 重新 `INSERT` | — | 多对多关联表不做软删；角色软删时关联行原地保留以便恢复 |
| **notifications** | 软删归档(A) | `deleted_at = NOW()` | ❌ 不提供恢复 | ✅ | 现状已软删（`remove` 设 `deleted_at`，查询带 `notDeleted`）；通知无恢复价值，维持软删，不改物理删 |
| **audit_logs** | 不删 | — | — | ✅ | 审计只增不删（已无 `deleted_at` 字段，保持） |

> 策略代号：A=逻辑软删(`deleted_at`)；B=状态位启停(`is_active`/`status`)；C=物理删除。users/error_whitelist 为 A+B 并存（启停与删除双维度）。

## 三、各表改动详解

### 3.1 users（软删 A）
- **后端**：`findAll`/`findById`/`create`/`update` 的查询 where 由 `isAdmin` 决定是否带 `notDeleted(users.deletedAt)`；新增 `restore(id)`。
- **恢复唯一冲突**：恢复前查同 username/email 是否存在未软删记录，冲突转 `409`（含 23505 TOCTOU 兜底）。
- **缓存**：`@Cacheable('user:id', 300)`，`restore` 与 `remove` 一致地 `cacheService.delByPattern('cache:user:*${id}*')`。
- **前端**：保留 `status` 列与 Switch（业务启停）；「删除」按钮改软删；对 `deleted_at` 非空行展示「恢复」按钮；新增「删除状态」列。

### 3.2 roles（软删 A）
- **后端**：查询按 `isAdmin` 过滤；新增 `restore(id)`；恢复需校验 `name` 唯一（partial unique index 已存在）。
- **关联表处理**：角色软删时 **不动** `role_permissions` 行，便于恢复后权限立即复用。
- **权限查询**：`UsersService.hasPermission` 增加 role 软删校验——role 被软删时该 role 的权限不生效。
- **前端**：新增「删除状态」列、「禁用/恢复」按钮。

### 3.3 permissions（软删 A）
- 同 roles，恢复校验 `code` 唯一。前端新增状态列。

### 3.4 files（软删 A，含磁盘隔离）
- **新增字段** `trash_path`（string, nullable）：软删时把磁盘文件 `rename` 到隔离目录并记下路径；恢复时按此路径 `rename` 回 `path`。
- **恢复定位**：不再用 filename 模糊匹配，直接凭 `trash_path` 精确还原；若 `trash_path` 为空（外部已删等）则仅恢复 DB 行并告警。
- **预览接口（重点修正）**：**不裸加 `@Public()`**，避免越权下载他人文件。现状 `preview` 已 `@Permissions(FILE_VIEW)` 但**无 `@CurrentUser`、`findById` 不校验所有权**——需新增 `@CurrentUser` 注入，service 内校验「管理员或上传者本人」后流式返回；对已软删文件返回 `404`。
- **前端**：新增状态列、禁用/恢复按钮；预览继续走鉴权接口，不直接拼公开 URL。

### 3.5 error_logs（软删归档 A，不可恢复）
- 字段 `deleted_at` 已存在，保留。删除即软删，普通用户不可见、管理员可见。
- **不提供 restore 接口**：日志归档无恢复价值，避免误导。
- 前端：保留 `isResolved` 列；删除按钮即软删归档。

### 3.6 error_whitelist（软删 A + 启停 B，并存，维持现状）
- **不动 schema**：现有 `deleted_at`（删除维度）+ `is_active`（启停维度）并存，与 users 同构。
- `removeWhitelist` 维持 `deleted_at = NOW()`；`checkWhitelist` 维持 `is_active = true` 过滤——「停用规则」(`is_active=false`) 自动失效，「删除规则」(`deleted_at`) 彻底移出列表。
- **支持 restore**（与 users 同构）：`restoreWhitelist(id)` 设 `deleted_at = NULL`,恢复后规则重新参与匹配；恢复后 `invalidateWhitelistCache`。
- 管理员可见含软删规则；普通用户/匹配逻辑不可见。
- 前端：保留 `isActive` 启停开关 + 新增删除状态列。

### 3.7 role_permissions（物理删 C，关联表不软删）
- 删除某条授权 = `DELETE`；需要时 `INSERT` 恢复。
- 角色**软删**时不级联删关联行（保留以便角色恢复）；角色**物理清理**时才级联删关联行。
- 不新增 `deleted_at`，不写 migration。

### 3.8 notifications（软删归档 A，维持现状，不可恢复）
- 现状 `remove` 已为 `set deleted_at`，`list/unreadCount/markAsRead` 均带 `notDeleted` 过滤——维持不动，不回退为物理删。
- 不提供 restore（通知无恢复价值）。
- 管理员可见含软删通知；普通用户不可见。

### 3.9 audit_logs（不删）
- 维持现状，无 `deleted_at`，无删除接口。

## 四、后端改动清单

### 4.1 公共模块
| 文件 | 改动 |
| :--- | :--- |
| `src/db/helpers.ts` | 新增 `maybeDeleted(column, include)`：`include` 为真返回 `undefined`（不加 where），否则返回 `notDeleted(column)`。**不使用 `sql\`TRUE\`` hack**。 |

### 4.2 schema / migration（v1 遗漏项，本版补齐）
| 文件 | 改动 |
| :--- | :--- |
| `src/db/schema/files.ts` | 新增 `trashPath: varchar('trash_path')` |
| `drizzle/` | 生成一条 migration：仅 `ALTER TABLE files ADD COLUMN trash_path varchar`。**role_permissions / error_whitelist / notifications 不改 schema**。 |

### 4.3 Service 层通用改动
| 改动项 | 适用表 | 说明 |
| :--- | :--- | :--- |
| 查询方法加 `includeDeleted` 参数 | users/roles/permissions/files | 管理员传 `true`，普通传 `false`，内部用 `maybeDeleted` |
| 新增 `restore(id)` | users/roles/permissions/files/error_whitelist | 恢复前校验唯一约束，冲突转 409；files 额外移回磁盘。error_whitelist 与 users 同构支持 restore（`deleted_at=NULL`） |
| 恢复后清缓存 | users | delByPattern；其余无缓存 |
| error_logs 软删归档 | error_logs | `remove` 设 `deleted_at`，不提供 restore |
| error_whitelist 维持现状 | error_logs(白名单部分) | `deleted_at` 软删 + `is_active` 启停并存，不改 schema |
| notifications 维持现状 | notifications | 已软删，不回退物理删，不提供 restore |
| role_permissions | — | 物理删，无 `deleted_at` 逻辑 |

### 4.4 Controller 层通用改动
| 改动项 | 说明 |
| :--- | :--- |
| 给 users/roles/permissions 的 `findAll`/`findOne`/`remove` 与 `files.findAll` 新增 `@CurrentUser()`（现状均未注入；`files.remove` 已有、`files.preview` 见下行） | 用于判定 `isAdmin` |
| `isAdmin` 判定方式：**沿用现状 `user.username === 'admin'`**（`TokenPayload` 仅含 `sub/username/email`，无 role 字段；files.controller remove 已用此法，`hasPermission` 对 admin 直接 return true）。**不要**新增 role 字段到 token。 | 控制查询可见范围 |
| 新增 `restore` 接口（`@Post(':id/restore')`） | users/roles/permissions/files；error_whitelist 在 error-logs 模块内补对应 restore 接口 |
| files.preview **不加 `@Public()`** | 维持鉴权；preview 现状无 `@CurrentUser`，需新增注入并在 service 内校验「管理员或上传者本人」后代理流，软删文件返 404 |
## 五、前端改动清单

### 5.1 通用
| 改动项 | 适用页面 |
| :--- | :--- |
| 「删除」按钮语义化：软删表→「禁用」；物理删表保持「删除」 | users/roles/permissions/files |
| 新增「恢复」按钮（仅 `deleted_at` 软删表） | users/roles/permissions/files |
| 新增「删除状态」列（按 `deleted_at` 显示 正常/已禁用） | users/roles/permissions/files |

### 5.2 各页面
| 页面 | 改动 |
| :--- | :--- |
| **users.tsx** | **保留 `status` 列与 Switch**（业务启停）；新增「删除状态」列；删除改软删；新增恢复按钮 |
| **roles.tsx** | 新增状态列、禁用/恢复按钮 |
| **permissions.tsx** | 新增状态列、禁用/恢复按钮 |
| **files.tsx** | 新增状态列、禁用/恢复按钮；预览仍走鉴权接口 |
| **error-logs.tsx** | 保留 `isResolved` 列；删除=软删归档（无恢复按钮） |
| **error-whitelist（error-logs 内）** | 保留 `isActive` 启停开关 + 新增删除状态列；删除=软删（`deleted_at`），可在白名单内恢复（`deleted_at = NULL`） |
| **audit-logs.tsx** | 无改动 |
| **notifications** | 无单独管理页；删除=软删归档（维持现状） |

## 六、需要改动的文件清单（去重校正版）

### 后端（实体模块）
1. `src/db/helpers.ts` — 新增 `maybeDeleted`
2. `src/db/schema/files.ts` — 新增 `trashPath`
3. `drizzle/` — 一条 migration（仅 files.trash_path）
4. `src/modules/users/users.service.ts` — include/restore/缓存
5. `src/modules/users/users.controller.ts` — 传 isAdmin + restore
6. `src/modules/roles/roles.service.ts` — include/restore + hasPermission 校验
7. `src/modules/roles/roles.controller.ts` — 传 isAdmin + restore
8. `src/modules/permissions/permissions.service.ts` — include/restore
9. `src/modules/permissions/permissions.controller.ts` — 传 isAdmin + restore
10. `src/modules/files/files.service.ts` — include/restore/trash_path/preview 鉴权代理
11. `src/modules/files/files.controller.ts` — 传 isAdmin + restore；preview 不动 @Public
12. `src/modules/error-logs/error-logs.service.ts` — error_logs 软删归档；白名单维持现状（`deleted_at` 软删 + `is_active` 启停）并补 restore + 管理员可见
13. `src/modules/error-logs/error-logs.controller.ts` — 对应接口（含白名单 restore）
14. `src/modules/notifications/notifications.service.ts` — 维持现状软删，仅补管理员可见（无 restore）

> 说明：error_whitelist 已合并在 `error-logs` 模块内，不作为独立文件。role_permissions 仅物理删，改动极小；notifications 维持现状软删，仅补管理员可见。

### 前端（6 个文件）
1. `src/routes/users.tsx`
2. `src/routes/roles.tsx`
3. `src/routes/permissions.tsx`
4. `src/routes/files.tsx`
5. `src/routes/error-logs.tsx`（含白名单区域）
6. `src/routes/audit-logs.tsx`（无改动，仅核对）

### 测试（6 个文件）
1. `src/modules/users/users.service.spec.ts`
2. `src/modules/roles/roles.service.spec.ts`
3. `src/modules/permissions/permissions.service.spec.ts`
4. `src/modules/files/files.service.spec.ts`
5. `src/modules/notifications/notifications.service.spec.ts`（软删归档断言 + 管理员可见）
6. `src/modules/error-logs/error-logs.service.spec.ts`（error_logs 归档 + 白名单软删/启停/restore，同一文件）

## 七、migration 与上线步骤

1. **生成 migration**：`pnpm drizzle-kit generate`，确认仅含 `ALTER TABLE files ADD COLUMN trash_path varchar`。
2. **校验**：`trash_path` nullable、无默认值；存量数据保持 null。
3. **存量数据**：无需回填——`deleted_at` null 即正常，`trash_path` null 即未隔离。
4. **回滚**：migration 失败时 `ALTER TABLE files DROP COLUMN trash_path` 即可，无数据丢失。
5. **部署顺序**：先后端发布（含 restore 接口）→ 跑 migration → 前端发布。

## 八、验收清单

### 后端
1. users/roles/permissions/files 使用 `deleted_at` 软删，恢复可用且唯一冲突转 409。
2. files 新增 `trash_path`，软删磁盘文件移隔离、恢复按 `trash_path` 精确还原。
3. files.preview 维持鉴权，未加 `@Public()`；已软删文件预览返回 404；普通用户不可访问他人文件。
4. error_logs 软删归档、不提供 restore；管理员可见、普通不可见。
5. error_whitelist `deleted_at` 软删 + `is_active` 启停并存，未改 schema；支持 restore。
6. role_permissions 物理删除；notifications 维持软删归档。
7. roles 软删时 `role_permissions` 原地保留；`hasPermission` 对软删 role 返回 false。
8. 管理员可见含软删数据，普通用户不可见。
9. users.restore 清缓存 `cache:user:*${id}*`。
10. `maybeDeleted` 写法生效，无 `WHERE TRUE` 残留。
11. restore 接口覆盖 users/roles/permissions/files/error_whitelist（error_logs/notifications 不提供）。
12. 单测/单测 e2e/smoke 全通过，typecheck/lint 0 失败。

### 前端
1. users 保留 `status` Switch，新增「删除状态」列与恢复按钮。
2. roles/permissions/files 新增状态列与禁用/恢复按钮。
3. error-logs 保留 `isResolved`；白名单保留 `isActive`；删除按钮语义正确。
4. 软删记录显示「已禁用」，恢复后回「正常」。
5. 文件预览不拼公开 URL。

## 九、失败条件

1. 管理员无法查看软删记录，或普通用户可见软删记录。
2. 软删表无法恢复，或恢复未处理唯一冲突。
3. files 恢复后磁盘文件未归位，或凭 filename 模糊匹配错位。
4. files.preview 被 `@Public()` 化导致越权，或软删文件可预览。
5. error_whitelist 被砍 `deleted_at` 或 notifications 被回退物理删（破坏现状）。
6. users.restore 未清缓存。
7. migration 误改非 files 表 schema。
8. 测试未通过。

## 十、实施计划（按批次，每批 ≤3 文件）

> **实施前置**：HEAD `accd705`（"移除 status 字段"）为半成品提交，砍了 schema 但残留 auth/users.service/setup/seed/shared/前端/spec 多处 `status` 引用且无对应 migration，typecheck 当前必挂。开工第一步 `git revert accd705` 回退 status 字段，恢复可编译基线后再按下方批次进行。

### 第一批：公共 + users
1. `helpers.ts` — `maybeDeleted`
2. `schema/files.ts` + `drizzle migration` — `trash_path`（提前到此批，便于文件批次使用）
3. `users.service.ts` + `users.controller.ts` — include/restore/缓存/接口

### 第二批：users 前端 + 测试
4. `users.tsx` — 保留 status、新增状态列与恢复按钮
5. `users.service.spec.ts` — restore + 唯一冲突 + 查询可见范围

### 第三批：roles
6. `roles.service.ts`（含 `hasPermission` role 软删校验）+ `roles.controller.ts`
7. `roles.tsx` + `roles.service.spec.ts`

### 第四批：permissions
8. `permissions.service.ts` + `permissions.controller.ts`
9. `permissions.tsx` + `permissions.service.spec.ts`

### 第五批：files
10. `files.service.ts`（trash_path、restore 归位、preview 鉴权代理）+ `files.controller.ts`
11. `files.tsx` + `files.service.spec.ts`

### 第六批：error-logs（含白名单）
12. `error-logs.service.ts` — error_logs 软删归档；白名单维持现状（`deleted_at` 软删 + `is_active` 启停），仅补管理员可见与 restore
13. `error-logs.controller.ts`
14. `error-logs.tsx` + `error-logs.service.spec.ts`

### 第七批：notifications + 收尾
15. `notifications.service.ts`（补管理员可见，维持软删）+ spec
16. 全量 typecheck + lint + 单测 + smoke + e2e + build
