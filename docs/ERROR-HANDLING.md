# 异常处理规范

## 错误日志规范

### 入库链路

1. **所有后端错误必须经 `ErrorLogsService.record()` 入库** - 禁止在 ExceptionFilter 或其他位置直接 `db.insert(errorLogs)`，以确保 `errorType` 与白名单缓存一致
2. **record 与 report 分桶** - 后端内部 `record()` 不走 IP 日限额（与公开 `report()` 分开）。若共用配额，攻击者可先打满自身 IP 配额，使后续真实攻击触发的后端 5xx 日志被拒（审计消音）
3. **5xx 入库，4xx 不入库** - 仅 `status >= 500` 时调 `errorLogsService.record()`，4xx 客户端错误不入库
4. **WS / Cron / mail.service 异常必须入库**：catch 块必须 `rethrow`（不能吞错），并调用 `errorLogsService.record()` 入库
5. **`mail.service` 的 `send`/`sendHtml` catch 必须抛 `new Error(...)`** - 让上层 controller 处理响应
6. **`bootstrap()` 顶层 catch**：`main.ts` 的 `bootstrap()` 必须链 `.catch((err) => { console.error('[Bootstrap] 启动失败:', err); process.exit(1) })`
7. **双写冗余**：错误日志同时写入数据库和日志文件（`apps/server/logs/error-YYYY-MM-DD.log`，按天滚动）

### 聚合查询

- `findGrouped` 必须 `where eq(isResolved=false)`，全处理后聚合列表自动隐藏

### 限流豁免

- error-logs 模块的只读接口（findAll/stats/grouped/whitelist）必须 `@SkipThrottle()`，避免 429

## 应用日志规范

### 运行时必须用 NestJS Logger

service / interceptor / guard / resolver / gateway 等**运行时组件**禁止 `console.error/warn/log`，必须用：

```ts
import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  async login(...) {
    try { ... } catch (err) {
      this.logger.error('登录失败:', err)
    }
  }
}
```

- 统一输出格式（带 context 命名空间），便于生产 grep 与排障
- 支持日志级别（`log/warn/error/debug/verbose`），便于按级别过滤
- 禁止 `console.error('[Xxx] ...')` 自造前缀，context 已由 `new Logger(ClassName.name)` 提供

### 允许 console 的例外

仅在 NestJS Logger 尚未就绪或不能调用的场景使用 `console`：

| 场景 | 文件 | 原因 |
|---|---|---|
| bootstrap 启动日志 | `main.ts` | Logger 依赖 DI，bootstrap 阶段未就绪 |
| 环境变量校验失败 | `config/env.ts` | 校验在 DI 之前执行 |
| 种子脚本 | `db/seed.ts` | 一次性脚本，不走 DI |
| FileLogger 自身写入失败兜底 | `common/logger.ts` | 不能递归调用自己 |

### 错误日志文件双写

- `appendErrorLog(message, stack)` 写入 `apps/server/logs/error-YYYY-MM-DD.log`（按天滚动）
- 作为数据库错误日志的兜底：DB 抖动时不丢日志
- 文件写入失败时降级到 `console.error`（`logger.ts:36`，唯一允许的 console 兜底）

### 白名单匹配

- 白名单规则用**字符串包含匹配**（非正则）判断 `message` 或 `url` 字段，避免 ReDoS 风险
- 白名单规则缓存在 Redis 中，TTL 60s；CRUD 操作后失效缓存
- 白名单 CRUD 仅 admin 角色可操作
- 白名单表格排序须稳定：`desc(createdAt), desc(id)` 作为 tie-breaker，避免操作后顺序变化

## HttpExceptionFilter（后端）

### 兼容 nestjs-zod v5 的 `issues` 字段

v5 的 `ZodValidationException.getResponse()` 返回 `{ statusCode, error, message: 'Validation failed', issues: [...] }`，issues 在 `responseObj.issues` 而非 `responseObj.message` 数组。filter 必须同时检查两处：

```ts
// 先尝试从 getZodError() 取完整 issues 并记录日志（nestjs-zod 特有方法）
const zodError = (exception as { getZodError?: () => unknown }).getZodError?.()
let zodIssuesLogged = false
if (zodError && typeof zodError === 'object' && 'issues' in zodError) {
  this.logger.error(`[Zod] issues: ${JSON.stringify((zodError as { issues: unknown }).issues)}`)
  zodIssuesLogged = true
}
// 安全铁律：issues 仅写入日志，不回传客户端，避免暴露字段约束被探测
if (Array.isArray(responseObj.issues)) {
  if (!zodIssuesLogged) {
    this.logger.error(`[Zod] issues: ${JSON.stringify(responseObj.issues)}`)
  }
  message = '参数校验失败'
} else if (Array.isArray(responseObj.message)) {
  // 兼容 nestjs-zod v4 及更早版本：issues 在 message 数组里
  if (!zodIssuesLogged) {
    this.logger.error(`[Zod] issues: ${JSON.stringify(responseObj.message)}`)
  }
  message = '参数校验失败'
} else {
  message = (responseObj.message as string) || exception.message
}
```

> **安全提示**：Zod 校验失败时，**禁止**把 `issues` 中的 `path`（字段名）和 `message`（规则）拼成 `field: message` 回传客户端。公开接口（`@Public`）下攻击者可据此探测校验规则绕过限制。统一返回"参数校验失败"，完整 issues 仅写入服务端日志。

## 前端 catch 块

### 强制使用 `extractErrorMessage`

禁止 `catch {}` 不读 error。所有异步 catch 必须用 `extractErrorMessage(error, fallback)` 提取后端返回的具体 message（优先级：`axiosError.response?.data?.message` > `error.message` > fallback）：

```ts
import { extractErrorMessage } from '@/lib/error'
try {
  await mutateAsync(data)
  messageApi.success('操作成功')
} catch (error) {
  messageApi.error(extractErrorMessage(error, '操作失败'))
}
```

- 加载失败统一用 `useEffect` 监听 `isError` 弹 toast，不用 `<Alert>` 常驻
- 删除/更新/创建操作必须 `mutateAsync + try/catch`，禁止 `mutate` 静默调用
