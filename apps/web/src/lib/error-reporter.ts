import type { ReportError } from '@shared'
import { api } from '@/lib/api'

/**
 * 上报前端错误到后端
 * 静默失败，不影响用户使用。
 * M7：入库前按 DB 列宽截断（message 2000/stack 3000/file·url 500），超长错误走 400
 * 丢弃会造成监控盲区，截断后至少可检索。
 */
export async function reportFrontendError(payload: ReportError): Promise<void> {
  try {
    // context 限 20 键/10KB（与 ReportErrorSchema 同宽），超限截断而非整单丢弃
    let context = payload.context
    if (context) {
      const keys = Object.keys(context).slice(0, 20)
      let trimmed: Record<string, unknown> = {}
      for (const k of keys) trimmed[k] = context[k]
      if (JSON.stringify(trimmed).length > 10240) {
        trimmed.__truncated = true
        for (const k of keys) {
          trimmed[k] =
            typeof trimmed[k] === 'string' ? (trimmed[k] as string).slice(0, 500) : trimmed[k]
          if (JSON.stringify(trimmed).length <= 10240) break
        }
        // 兜底：非字符串大对象值（如嵌套请求体）字符串截断救不回来时，
        // 整体序列化截断保证错误仍可入库检索，避免静默丢失（M7 残余）
        if (JSON.stringify(trimmed).length > 10240) {
          trimmed = { __truncated: true, raw: JSON.stringify(trimmed).slice(0, 9000) }
        }
      }
      context = trimmed
    }
    await api.post('/api/v1/error-logs/report', {
      ...payload,
      // L32：safeSlice 防止截断点落在 UTF-16 代理对（emoji 等）中间产生尾部乱字符
      message: safeSlice(payload.message, 2000),
      stack: payload.stack && safeSlice(payload.stack, 3000),
      file: payload.file && safeSlice(payload.file, 500),
      url: payload.url && safeSlice(payload.url, 500),
      method: payload.method && safeSlice(payload.method, 10),
      context,
    })
  } catch {}
}

// 末位是高代理项（D800-DBFF）说明劈开了代理对，去掉该半字符
function safeSlice(value: string, max: number): string {
  const cut = value.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

/**
 * 安装全局错误捕获器
 * 捕获 JS 运行时错误、未处理 Promise 异常、资源加载失败
 */
export function installGlobalErrorHandlers(): void {
  window.onerror = (message, source, lineno, colno, error) => {
    reportFrontendError({
      source: 'frontend',
      errorType: 'js_error',
      message: String(message),
      stack: error?.stack,
      file: source ?? undefined,
      line: lineno ?? undefined,
      column: colno ?? undefined,
      url: window.location.href,
    })
  }

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: unknown; stack?: string } | null | undefined
    // L22：非 Error 的 reject 原因（纯对象/数字）String() 成 [object Object] 噪音；
    // 有 message 取 message，否则 JSON 兜底
    const message =
      typeof reason?.message === 'string' && reason.message
        ? reason.message
        : (() => {
            try {
              return `Unhandled rejection: ${JSON.stringify(reason) ?? String(reason)}`
            } catch {
              return `Unhandled rejection: ${String(reason)}`
            }
          })()
    reportFrontendError({
      source: 'frontend',
      errorType: 'unhandled_promise',
      message,
      stack: reason?.stack,
      url: window.location.href,
    })
  })

  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement
      if (target?.tagName === 'IMG' || target?.tagName === 'SCRIPT' || target?.tagName === 'LINK') {
        // L22：空串 src 用 ?? 穿透成残尾（'资源加载失败: '），改 || 落 'unknown'
        const src = (target as HTMLImageElement).src || target.getAttribute('href') || 'unknown'
        reportFrontendError({
          source: 'frontend',
          errorType: 'resource_error',
          message: `资源加载失败: ${src}`,
          url: window.location.href,
        })
      }
    },
    true,
  )
}
