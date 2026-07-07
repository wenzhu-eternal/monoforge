import type { AxiosError } from 'axios'

/**
 * 从 axios 错误中提取后端返回的 message
 * 后端统一返回 { code, message, data } 结构
 */
export function extractErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (!error || typeof error !== 'object') return fallback

  const axiosError = error as AxiosError<{ message?: string }>
  const backendMessage = axiosError.response?.data?.message
  if (backendMessage && typeof backendMessage === 'string') return backendMessage

  if (error instanceof Error && error.message) return error.message

  return fallback
}
