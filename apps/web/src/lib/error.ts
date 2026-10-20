import type { AxiosError } from 'axios'

/**
 * 从 axios 错误中提取后端返回的 message
 * 后端统一返回 { code, message, data } 结构
 * message 可能是 string 或 Zod issue 数组
 */
export function extractErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (!error || typeof error !== 'object') return fallback

  const axiosError = error as AxiosError<{ message?: unknown }>
  // L5：responseType:'blob' 的错误体也是 Blob，读不到 message 会落英文裸文案
  if (typeof Blob !== 'undefined' && axiosError.response?.data instanceof Blob) {
    return fallback
  }
  const backendMessage = axiosError.response?.data?.message
  if (backendMessage) {
    if (typeof backendMessage === 'string') return backendMessage
    if (Array.isArray(backendMessage)) {
      return backendMessage
        .map((item: { message?: string } | string) =>
          typeof item === 'string' ? item : (item.message ?? ''),
        )
        .filter(Boolean)
        .join('; ')
    }
  }

  // L15：axios 网络层错误无后端文案时，返回中文提示而非裸英文
  if (axiosError.code === 'ERR_NETWORK' || axiosError.message?.includes('Network')) {
    return '网络连接失败，请检查网络后重试'
  }
  if (axiosError.code === 'ERR_TIMEOUT' || axiosError.message?.includes('timeout')) {
    return '请求超时，请稍后重试'
  }

  if (error instanceof Error && error.message) return error.message

  return fallback
}
