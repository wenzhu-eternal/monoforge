import { ErrorCodes, ErrorMessages } from '@shared'
import axios, { type AxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/store/auth-store'
import { clearUserScopedState } from './auth-cleanup'
import { env } from './env'

/**
 * 扩展 axios 请求配置：允许调用方声明 403 时不整页跳转，由页面自行展示无权限
 * （如仪表盘统计）。新页面有同类需求时在各自调用处声明即可，拦截器不再逐 URL 豁免。
 */
export interface ApiRequestConfig extends AxiosRequestConfig {
  skipForbiddenRedirect?: boolean
}

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
 * 应用初始化时调用：若 isAuthenticated 但 token 为空（旧版本遗留的持久化数据），
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
    clearUserScopedState()
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

    // 403 统一跳转 /403，与前端 AuthenticatedLayout 行为一致。
    // 例外：调用方声明 skipForbiddenRedirect 的请求（如仪表盘统计）由页面右侧内容区
    // 自行展示无权限，菜单照常显示，不整页跳转。
    if (
      error.response?.status === 403 &&
      !window.location.pathname.startsWith('/403') &&
      !window.location.pathname.startsWith('/login') &&
      !(originalRequest as ApiRequestConfig | undefined)?.skipForbiddenRedirect
    ) {
      window.location.href = '/403'
      return Promise.reject(error)
    }

    // 强制改密场景：后端 AuthGuard 对白名单外接口返回此 401，token 本身有效，
    // 不能走 refresh/logout 流程（refresh 同样被拒会导致弹回 /login），直接引导到改密页。
    // L16：用共享常量判定（原手写中文全等匹配，文案一改即失效）
    if (
      error.response?.status === 401 &&
      error.response?.data?.message === ErrorMessages[ErrorCodes.MUST_CHANGE_PASSWORD] &&
      !window.location.pathname.startsWith('/change-password')
    ) {
      window.location.href = '/change-password'
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
            // N5：中文文案（原英文裸文案经 extractErrorMessage 直接透传给用户）
            reject(new Error('登录状态刷新超时，请重新登录'))
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
          // 排队请求重试前同样标记，避免再次 401 时重入刷新循环（H5）
          originalRequest._retry = true
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
        clearUserScopedState()
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)
