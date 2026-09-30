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
      const trimmed: Record<string, unknown> = {}
      for (const k of keys) trimmed[k] = context[k]
      if (JSON.stringify(trimmed).length > 10240) {
        trimmed.__truncated = true
        for (const k of keys) {
          trimmed[k] =
            typeof trimmed[k] === 'string' ? (trimmed[k] as string).slice(0, 500) : trimmed[k]
          if (JSON.stringify(trimmed).length <= 10240) break
        }
      }
      context = trimmed
    }
    await api.post('/api/v1/error-logs/report', {
      ...payload,
      message: payload.message.slice(0, 2000),
      stack: payload.stack?.slice(0, 3000),
      file: payload.file?.slice(0, 500),
      url: payload.url?.slice(0, 500),
      method: payload.method?.slice(0, 10),
      context,
    })
  } catch {}
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
    const reason = event.reason
    reportFrontendError({
      source: 'frontend',
      errorType: 'unhandled_promise',
      message: reason?.message ?? String(reason),
      stack: reason?.stack,
      url: window.location.href,
    })
  })

  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement
      if (target?.tagName === 'IMG' || target?.tagName === 'SCRIPT' || target?.tagName === 'LINK') {
        reportFrontendError({
          source: 'frontend',
          errorType: 'resource_error',
          message: `资源加载失败: ${(target as HTMLImageElement).src ?? target.getAttribute('href') ?? 'unknown'}`,
          url: window.location.href,
        })
      }
    },
    true,
  )
}
