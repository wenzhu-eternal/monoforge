# 软删除整体方案

> 本方案由 AI 助手整理，供复查使用。

## 一、核心原则

1. **`deleted_at` = 禁用**（有值=禁用，null=正常）
2. **没有物理删除**（除了 `audit_logs` 不支持删除）
3. **管理员可见**（管理员可查看所有记录，包括禁用的）
4. **可恢复**（禁用的记录可以恢复）

## 二、各表软删除逻辑

| 表名 | 禁用操作 | 恢复操作 | 管理员可见 | 可恢复 |
| :--- | :--- | :--- | :--- | :--- |
| **users** | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ 是 | ✅ 是 |
| **roles** | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ 是 | ✅ 是 |
| **permissions** | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ 是 | ✅ 是 |
| **role_permissions** | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ 是 | ✅ 是 |
| **files** | `deleted_at = NOW()` + 移动文件到隔离目录 | `deleted_at = NULL` + 移动文件回原位 | ✅ 是 | ✅ 是 |
| **notifications** | `deleted_at = NOW()` | 不支持恢复 | ❌ 否 | ❌ 否 |
| **audit_logs** | 不支持删除 | - | ✅ 是 | - |
| **error_logs** | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ 是 | ✅ 是 |
| **error_whitelist** | `deleted_at = NOW()` | `deleted_at = NULL` | ✅ 是 | ✅ 是 |

## 三、后端改动清单

### 3.1 公共模块
| 文件 | 改动内容 |
| :--- | :--- |
| `src/db/helpers.ts` | 新增 `includeDeleted()` 函数，返回 `sql\`TRUE\`` |

### 3.2 Service 层（每个 Service 都需要）
| 改动项 | 说明 |
| :--- | :--- |
| 查询方法添加 `isAdmin` 参数 | 管理员传 `true`，普通用户传 `false` |
| 管理员查询使用 `includeDeleted()` | 普通用户继续使用 `notDeleted()` |
| 新增 `restore(id)` 方法 | 将 `deleted_at` 设为 `null` |

### 3.3 Controller 层（每个 Controller 都需要）
| 改动项 | 说明 |
| :--- | :--- |
| 从 `@CurrentUser()` 获取用户角色 | 判断是否是管理员 |
| 将 `isAdmin` 传入 Service | 控制查询逻辑 |
| 新增 `restore` 接口 | 调用 Service 的 `restore` 方法 |

### 3.4 文件预览接口
| 文件 | 改动内容 |
| :--- | :--- |
| `src/modules/files/files.controller.ts` | `preview` 方法添加 `@Public()` 装饰器 |

## 四、前端改动清单

### 4.1 所有管理页面通用改动
| 改动项 | 说明 |
| :--- | :--- |
| "删除"按钮改为"禁用"按钮 | 按钮文字改为"禁用"，调用禁用接口 |
| 新增"恢复"按钮 | 对禁用记录显示，调用恢复接口 |
| 表格新增"状态"列 | 根据 `deleted_at` 判断显示"正常"/"已禁用" |

### 4.2 各模块特殊改动
| 模块 | 特殊改动 |
| :--- | :--- |
| **users.tsx** | 移除 `status` 列和 Switch 开关 |
| **roles.tsx** | 新增状态列 |
| **permissions.tsx** | 新增状态列 |
| **files.tsx** | 新增状态列 |
| **error-logs.tsx** | 保留 `isResolved` 列（用于标记错误是否已处理） |
| **error-whitelist.tsx** | 保留 `isActive` 列（用于控制白名单规则是否生效） |
| **audit-logs.tsx** | 无改动（不支持删除） |

### 4.3 文件预览
| 改动项 | 说明 |
| :--- | :--- |
| `files.tsx` | 预览可以直接使用 URL，不需要通过 `api.get` 调用 |

## 五、需要改动的文件清单

### 后端（15 个文件）
1. `src/db/helpers.ts`
2. `src/modules/users/users.service.ts`
3. `src/modules/users/users.controller.ts`
4. `src/modules/roles/roles.service.ts`
5. `src/modules/roles/roles.controller.ts`
6. `src/modules/permissions/permissions.service.ts`
7. `src/modules/permissions/permissions.controller.ts`
8. `src/modules/files/files.service.ts`
9. `src/modules/files/files.controller.ts`
10. `src/modules/notifications/notifications.service.ts`
11. `src/modules/notifications/notifications.controller.ts`
12. `src/modules/error-logs/error-logs.service.ts`
13. `src/modules/error-logs/error-logs.controller.ts`
14. `src/modules/error-logs/error-logs.service.ts`（白名单部分）
15. `src/modules/error-logs/error-logs.controller.ts`（白名单部分）

### 前端（7 个文件）
1. `src/routes/users.tsx`
2. `src/routes/roles.tsx`
3. `src/routes/permissions.tsx`
4. `src/routes/files.tsx`
5. `src/routes/error-logs.tsx`
6. `src/routes/audit-logs.tsx`（无改动）
7. `src/routes/notifications.tsx`（如有单独页面）

### 测试用例（7 个文件）
1. `src/modules/users/users.service.spec.ts`
2. `src/modules/roles/roles.service.spec.ts`
3. `src/modules/permissions/permissions.service.spec.ts`
4. `src/modules/files/files.service.spec.ts`
5. `src/modules/notifications/notifications.service.spec.ts`
6. `src/modules/error-logs/error-logs.service.spec.ts`
7. `src/modules/error-logs/error-logs.service.spec.ts`（白名单部分）

## 六、验收清单

### 后端
1.  所有需要软删除的表都使用 `deleted_at` 字段
2.  管理员可查看所有记录（包括禁用的）
3.  普通用户只能看到正常记录
4.  禁用的记录可恢复（`notifications` 和 `audit_logs` 除外）
5.  `role_permissions` 使用软删除
6.  `audit_logs` 不支持删除
7.  `files` 恢复时磁盘文件从隔离目录移回原位
8.  文件预览接口使用 `@Public()` 装饰器
9.  所有测试用例通过

### 前端
1.  所有模块的"删除"按钮改为"禁用"按钮
2.  所有模块新增"恢复"按钮（`audit-logs` 除外）
3.  `users.tsx` 移除状态列和 Switch 开关
4.  `roles.tsx`、`permissions.tsx`、`files.tsx` 新增状态列（根据 `deleted_at` 判断）
5.  `error-logs.tsx` 保留 `isResolved` 列
6.  `error-whitelist.tsx` 保留 `isActive` 列
7.  禁用的记录在表格中显示"已禁用"状态
8.  恢复后记录状态变为"正常"

## 七、失败条件

1.  管理员无法查看禁用的记录
2.  普通用户可以看到禁用的记录
3.  无法恢复禁用的记录
4.  `files` 恢复后磁盘文件未移回
5.  文件预览接口仍需登录
6.  所有测试用例未通过

## 八、实施计划

### 第一批：公共模块 + 用户模块（3 个文件）
1. `helpers.ts` - 新增 `includeDeleted`
2. `users.service.ts` - 添加 `isAdmin` 参数 + `restore` 方法
3. `users.controller.ts` - 传入 `isAdmin`

### 第二批：用户前端 + 测试（2 个文件）
4. `users.tsx` - 移除 Switch，添加"禁用"/"恢复"按钮
5. `users.service.spec.ts` - 添加 `restore` 测试 + 调整查询测试

### 第三批：角色模块（3 个文件）
6. `roles.service.ts` - 添加 `isAdmin` 参数 + `restore` 方法
7. `roles.controller.ts` - 传入 `isAdmin`
8. `roles.tsx` - 添加"禁用"/"恢复"按钮

### 第四批：权限模块（3 个文件）
9. `permissions.service.ts` - 添加 `isAdmin` 参数 + `restore` 方法
10. `permissions.controller.ts` - 传入 `isAdmin`
11. `permissions.tsx` - 添加"禁用"/"恢复"按钮

### 第五批：文件模块（3 个文件）
12. `files.service.ts` - 添加 `isAdmin` 参数 + `restore` 方法
13. `files.controller.ts` - 传入 `isAdmin` + 添加 `@Public()`
14. `files.tsx` - 添加"禁用"/"恢复"按钮

### 第六批：通知模块（2 个文件）
15. `notifications.service.ts` - 添加 `isAdmin` 参数
16. `notifications.controller.ts` - 传入 `isAdmin`

### 第七批：错误日志模块（3 个文件）
17. `error-logs.service.ts` - 添加 `isAdmin` 参数 + `restore` 方法
18. `error-logs.controller.ts` - 传入 `isAdmin`
19. `error-logs.tsx` - 添加"禁用"/"恢复"按钮

### 第八批：错误白名单模块（3 个文件）
20. `error-whitelist.service.ts` - 添加 `isAdmin` 参数 + `restore` 方法
21. `error-whitelist.controller.ts` - 传入 `isAdmin`
22. `error-whitelist.tsx` - 添加"禁用"/"恢复"按钮

### 第九批：测试用例（6 个文件）
23. `roles.service.spec.ts`
24. `permissions.service.spec.ts`
25. `files.service.spec.ts`
26. `notifications.service.spec.ts`
27. `error-logs.service.spec.ts`
28. `error-whitelist.service.spec.ts`
