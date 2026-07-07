# 异常处理规范

## 错误日志规范

### 入库链路

1. **所有后端错误必须经 `ErrorLogsService.record()` 入库** - 禁止在 ExceptionFilter 或其他位置直接 `db.insert(errorLogs)`，以确保 `errorType` 与白名单缓存一致
2. **5xx 入库，4xx 不入库** - 仅 `status >= 500` 时调 `errorLogsService.record()`，4xx 客户端错误不入库
3. **WS / Cron / mail.service 异常必须入库**：catch 块必须 `rethrow`（不能吞错），并调用 `errorLogsService.record()` 入库
4. **`mail.service` 的 `send`/`sendHtml` catch 必须抛 `new Error(...)`** - 让上层 controller 处理响应
5. **`bootstrap()` 顶层 catch**：`main.ts` 的 `bootstrap()` 必须链 `.catch((err) => { console.error('[Bootstrap] 启动失败:', err); process.exit(1) })`
6. **双写冗余**：错误日志同时写入数据库和日志文件（`apps/server/logs/error-YYYY-MM-DD.log`，按天滚动）

### 聚合查询

- `findGrouped` 必须 `where eq(isResolved=false)`，全处理后聚合列表自动隐藏

### 限流豁免

- error-logs 模块的只读接口（findAll/stats/grouped/whitelist）必须 `@SkipThrottle()`，避免 429

### 白名单匹配

- 白名单规则用**字符串包含匹配**（非正则）判断 `message` 或 `url` 字段，避免 ReDoS 风险
- 白名单规则缓存在 Redis 中，TTL 60s；CRUD 操作后失效缓存
- 白名单 CRUD 仅 admin 角色可操作
- 白名单表格排序须稳定：`desc(createdAt), desc(id)` 作为 tie-breaker，避免操作后顺序变化

## HttpExceptionFilter（后端）

### 兼容 nestjs-zod v5 的 `issues` 字段

v5 的 `ZodValidationException.getResponse()` 返回 `{ statusCode, error, message: 'Validation failed', issues: [...] }`，issues 在 `responseObj.issues` 而非 `responseObj.message` 数组。filter 必须同时检查两处：

```ts
if (Array.isArray(responseObj.issues)) {
  const issues = responseObj.issues as Array<{ message?: string; path?: unknown[] }>
  message = issues.map((i) => {
    const field = i.path?.length ? `${String(i.path[i.path.length - 1])}: ` : ''
    return field + (i.message ?? '')
  }).filter(Boolean).join('; ') || exception.message
} else if (Array.isArray(responseObj.message)) {
  // 兼容 v4 及更早版本
  const issues = responseObj.message as Array<{ message?: string }>
  message = issues.map((i) => i.message).filter(Boolean).join('; ') || exception.message
} else {
  message = (responseObj.message as string) || exception.message
}
```

不兼容此结构会导致用户只看到无意义的 "Validation failed"，丢失具体字段和错误信息。

## 前端 catch 块

### 强制使用 `extractErrorMessage`

禁止 `catch {}` 不读 error。所有异步 catch 必须用 `extractErrorMessage(error, fallback)` 提取后端返回的具体 message：

```ts
import { extractErrorMessage } from '@/lib/error'
try {
  await mutateAsync(data)
  messageApi.success('操作成功')
} catch (error) {
  messageApi.error(extractErrorMessage(error, '操作失败'))
}
```

### `extractErrorMessage` 优先级

`axiosError.response?.data?.message`（后端返回）> `error.message`（Error 实例）> fallback 字符串

工具实现位于 `apps/web/src/lib/error.ts`。

### 加载失败统一用 `useEffect` 监听 `isError`

query hook 的 `isError` + `error` 在 useEffect 中弹 toast，不用 `<Alert>` 常驻。

### 操作反馈

- 删除/更新/创建操作必须 `mutateAsync + try/catch`，成功 `messageApi.success`，失败 `messageApi.error(extractErrorMessage(...))`
- 禁止用 `mutate` 静默调用（吞掉错误）
