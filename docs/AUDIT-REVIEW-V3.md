# MonoForge 代码审查报告 v3

> 本报告为上一轮对话中由 AI 进行的全面审查结论（事后落盘）。审查方法：独立读代码 + 与 V1/V2 交叉核对。基线为 V2 修复后的代码状态。

## 审查范围

- 认证与 JWT 安全（auth/users/permissions/wechat/guards）
- 文件服务与上传安全（files/file-validator）
- WebSocket 与实时通信
- 输入验证与 XSS/注入防护
- 数据库与并发控制
- 配置/环境/部署/Docker
- 前端权限与路由守卫
- 注释一致性专项检查

## 主要结论（当时认定）

### 已确认修复项

| # | V1/V2 问题 | V3 核验结论 |
|---|---|---|
| 1 | USER_ROLE_MANAGE / NOTIFICATION_VIEW 权限码未在 seed 创建 | admin 直通不受影响，权限码集中管理 ✅ |
| 2 | permissions.service.remove 无绑定校验 | 删前校验角色绑定，有绑定的权限不可删 ✅ |
| 3 | 文件 restore 并发致 404 | DB 条件更新抢锁（deletedAt isNotNull → null）+ 路径安全校验 ✅ |
| 4 | scanForMalware 仅扫前 64KB | 改为 readFile 全文件扫描 ✅ |
| 5 | 前端 requirePermission 不实际校验权限 | 重构为 getRequiredPermission 路径映射 + AuthenticatedLayout 校验 ✅ |
| 6 | F18 首登强制改密 | users schema 加 mustChangePassword 字段 + 迁移 + seed + change-password 页面 ✅ |

### 当时认定已修复（后被 V4 证实为误判）

| # | V3 结论 | V4 取证真相 |
|---|---|---|
| A | error-logs 白名单缓存已修复，checkWhitelist 和 findWhitelist 使用不同缓存 key | ❌ 误判。error-logs.service.ts:28 仍共用单一 `WHITELIST_CACHE_KEY`，V2 F15 修复让 checkWhitelist 也回填缓存后，两方法回填不同数据集（活跃子集 vs 全集）造成污染 |
| B | preview XSS 已修复，对 html/svg 强制 attachment 下载，添加 X-Content-Type-Options: nosniff | ❌ 误判。files.controller.ts preview 接口无 nosniff header、无 html/svg 强制 attachment |

## 注释失真修复（当时完成）

- wechat.service.ts：注释称用户名取 openId 前 8 位，实际用完整 openId → 修正注释
- file-validator.ts：注释称仅校验 jpg/png/gif/pdf，实际包含更多类型 → 修正注释

## 边缘场景与遗留项

1. 现有 admin 账户不会自动触发 mustChangePassword（仅新 seed 生效）
2. 迁移 SQL 因 drizzle snapshot 碰撞需手动执行
3. /change-password 绕过 AuthenticatedLayout 避免循环，但首帧渲染 null

## 验证

- lint 通过
- 203 单元测试通过
- typecheck 通过

## 反思

V3 在两个关键点上误判"已修复"（白名单缓存 key、preview XSS），原因是：
1. 未亲自读取最终代码确认，依赖了修复意图而非修复结果
2. 对 checkWhitelist 回填缓存的副作用预判不足

V4 已通过主会话亲自 grep + sed 取证纠正这两处误判，详见 `docs/AUDIT-REVIEW-V4.md`。
