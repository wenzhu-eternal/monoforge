import axios from 'axios'
import { useAuthStore } from '@/store/auth-store'
import { env } from './env'

export const api = axios.create({
  baseURL: env.VITE_API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

let isRefreshing = false
let failedQueue: Array<{
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}> = []

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error)
    } else {
      resolve(token)
    }
  })
  failedQueue = []
}

/**
 * 应用初始化时调用：若 isAuthenticated 但 token 为空（页面刷新后），
 * 主动用 httpOnly cookie refresh token 恢复 access token，
 * 减少首个请求 401 的概率。
 */
// refresh 与业务请求统一走 VITE_API_BASE_URL（默认空为同源相对路径；分离部署时该值必配，否则 refresh 打到前端自身域名 404）
const refreshUrl = `${env.VITE_API_BASE_URL}/api/v1/auth/refresh`

function buildRefreshPayload() {
  return {}
}

export async function bootstrapAuth(): Promise<void> {
  const { isAuthenticated, token } = useAuthStore.getState()
  if (!isAuthenticated || token) return

  try {
    const response = await axios.post(
      refreshUrl,
      {},
      {
        withCredentials: true,
      },
    )
    const { accessToken } = response.data.data
    useAuthStore.getState().setToken(accessToken)
  } catch {
    useAuthStore.getState().logout()
  }
}

api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean }

    // 403 统一跳转 /403，与前端 AuthenticatedLayout 行为一致
    if (
      error.response?.status === 403 &&
      !window.location.pathname.startsWith('/403') &&
      !window.location.pathname.startsWith('/login')
    ) {
      window.location.href = '/403'
      return Promise.reject(error)
    }

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/api/v1/auth/refresh') &&
      !originalRequest.url?.includes('/api/v1/auth/login')
    ) {
      if (isRefreshing) {
        // 排队等待 refresh 完成，加 15s 超时避免永久挂起
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Refresh token timeout'))
          }, 15000)
          failedQueue.push({
            resolve: (v) => {
              clearTimeout(timer)
              resolve(v)
            },
            reject: (e) => {
              clearTimeout(timer)
              reject(e)
            },
          })
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        // refreshToken 走 httpOnly cookie；同源部署（VITE_API_BASE_URL 为空）时走相对路径经 Vite 代理携带 cookie
        const response = await axios.post(refreshUrl, buildRefreshPayload(), {
          withCredentials: true,
        })
        const { accessToken } = response.data.data

        useAuthStore.getState().setToken(accessToken)
        processQueue(null, accessToken)

        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        useAuthStore.getState().logout()
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)
