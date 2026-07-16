import type { ReportError } from '@shared'
import { api } from '@/lib/api'

/**
 * 上报前端错误到后端
 * 静默失败，不影响用户使用
 */
export async function reportFrontendError(payload: ReportError): Promise<void> {
  try {
    await api.post('/api/v1/error-logs/report', payload)
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

  // IMG/SCRIPT/LINK
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
