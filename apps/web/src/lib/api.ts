import { ErrorCodes, ErrorMessages } from '@shared'
import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/store/auth-store'
import { clearUserScopedState } from './auth-cleanup'
import { env } from './env'

/**
 * 扩展 axios 请求配置：允许调用方声明 403 时不整页跳转，由页面自行展示无权限
 * （如仪表盘统计）。新页面有同类需求时在各自调用处声明即可，拦截器不再逐 URL 豁免。
 */
export interface ApiRequestConfig extends AxiosRequestConfig {
  skipForbiddenRedirect?: boolean
  /**
   * M10：旁路请求（错误上报等）——401 不得触发刷新链（避免上报把用户刷登出/弹回登录页）、
   * 403 不整页跳转、强制改密不劫持。这类请求静默失败即可，失败本身不值得打扰用户。
   */
  skipAuthFlow?: boolean
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
 * M11：跨 tab 刷新单飞——refresh token 轮换后，并发刷新互相打吊（旧码复用即失效），
 * 多 tab 各自收到 401 再各自刷新会把彼此踢下线。Web Locks 把同 origin 的刷新串行化；
 * 等锁期间已有 tab 刷成功（完成时刻晚于本请求发出）则直接复用其产物，不重复消费 refresh cookie。
 */
const REFRESH_LOCK_NAME = 'monoforge-auth-refresh'
const REFRESH_AT_KEY = 'monoforge-auth-refresh-at'
const REFRESH_TOKEN_KEY = 'monoforge-auth-refresh-token'

/**
 * 执行一次 access token 刷新（跨 tab 单飞 + 等锁复用）。
 * L31：刷新请求必须带 15s 超时——排队请求有 15s 兜底，刷新者自身没有时网关挂起会永久悬挂。
 * @param issuedAt 本方需要刷新的时刻（401 发生/调用发起），用于判定等锁期间他人是否已刷新
 */
// M9/M11：同 tab 并发调用（拦截器队列 / bootstrapAuth / WS 踢线刷新）共享同一 in-flight——
// refresh token 单次消费（Redis GETDEL），同 tab 内各发一次必有一发被打吊
let inflightRefresh: Promise<string> | null = null

export async function refreshAccessToken(issuedAt = Date.now()): Promise<string> {
  if (inflightRefresh) return inflightRefresh
  const task = (async () => {
    const doRefresh = async (): Promise<string> => {
      let doneAt = 0
      try {
        doneAt = Number(localStorage.getItem(REFRESH_AT_KEY) ?? 0)
      } catch {
        /* 存储不可访问 */
      }
      let shared: string | null = null
      try {
        shared = localStorage.getItem(REFRESH_TOKEN_KEY)
      } catch {
        /* 存储不可访问 */
      }
      if (doneAt >= issuedAt && shared) {
        // 同步本 tab store，后续请求直接用新 token
        useAuthStore.getState().setToken(shared)
        return shared
      }
      const response = await axios.post(refreshUrl, buildRefreshPayload(), {
        withCredentials: true,
        timeout: 15_000,
      })
      const { accessToken } = response.data.data as { accessToken: string }
      try {
        localStorage.setItem(REFRESH_AT_KEY, String(Date.now()))
        localStorage.setItem(REFRESH_TOKEN_KEY, accessToken)
      } catch {
        // 存储不可用（隐私模式等）退化为无共享，锁仍生效
      }
      return accessToken
    }

    // L11：无 Web Locks（Safari<16.4 等）跨 tab 并发刷新无互斥——他 tab 先消费单次
    // cookie 后本方必 401，被无差别登出。失败后等 500ms 二次检查共享 AT 键：他 tab
    // 已刷新则直接采用其结果；存储不可用时无共享可言，照常抛原错误
    // M2：must-change 判定已移入拦截器 catch（此处赋值 href 会被外层 catch 的
    // href='/login' 覆盖——同一 JS 任务内后赋值者赢，本方跳转永不生效）
    const refreshWithSharedFallback = async (): Promise<string> => {
      try {
        return await doRefresh()
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        let doneAt2 = 0
        let shared2: string | null = null
        try {
          doneAt2 = Number(localStorage.getItem(REFRESH_AT_KEY) ?? 0)
        } catch {
          /* 存储不可访问 */
        }
        try {
          shared2 = localStorage.getItem(REFRESH_TOKEN_KEY)
        } catch {
          /* 存储不可访问 */
        }
        if (doneAt2 >= issuedAt && shared2) {
          useAuthStore.getState().setToken(shared2)
          return shared2
        }
        throw error
      }
    }

    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (locks) {
      let callbackStarted = false
      try {
        return await locks.request(REFRESH_LOCK_NAME, async () => {
          callbackStarted = true
          return doRefresh()
        })
      } catch (error) {
        // Q1：锁 API 自身异常（跨域 iframe SecurityError / tab 关闭 AbortError）不能直接
        // 判终态；仅在回调尚未执行时回落共享键二查，回调已执行则保留其真实刷新错误
        if (callbackStarted) throw error
      }
    }
    return refreshWithSharedFallback()
  })()
  inflightRefresh = task
  try {
    return await task
  } finally {
    if (inflightRefresh === task) inflightRefresh = null
  }
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
    const accessToken = await refreshAccessToken()
    useAuthStore.getState().setToken(accessToken)
  } catch {
    clearUserScopedState()
  }
}

// L27：跳转统一出口——拦截器跳转分支（403/改密/登出）在 spec 中可断言目标
export const authRedirect = {
  to(path: string): void {
    window.location.href = path
  },
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

    // M10：旁路请求不卷入认证流程——401 不刷新、403 不跳转、强制改密不劫持，静默失败
    if ((originalRequest as ApiRequestConfig | undefined)?.skipAuthFlow) {
      return Promise.reject(error)
    }

    // 403 统一跳转 /403，与前端 AuthenticatedLayout 行为一致。
    // 例外1：调用方声明 skipForbiddenRedirect 的请求（如仪表盘统计）由页面右侧内容区
    // 自行展示无权限，菜单照常显示，不整页跳转。
    // 例外2（M13）：写操作 403 多为按钮点击与权限回收的竞态，整页跳 /403 会丢列表/搜索
    // 语境——交给调用方 catch 展示错误即可，仅读操作 403 视为视图级无权限跳转
    if (
      error.response?.status === 403 &&
      !window.location.pathname.startsWith('/403') &&
      !window.location.pathname.startsWith('/login') &&
      !(originalRequest as ApiRequestConfig | undefined)?.skipForbiddenRedirect &&
      originalRequest?.method?.toUpperCase() === 'GET'
    ) {
      authRedirect.to('/403')
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
      authRedirect.to('/change-password')
      return Promise.reject(error)
    }

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/api/v1/auth/refresh') &&
      !originalRequest.url?.includes('/api/v1/auth/login') &&
      // M1：注册链路的 401（验证码错误等）与登录同理——本就是未登录态，进刷新链
      // 必失败并触发终态登出整页重载，吞掉注册页的错误提示
      !originalRequest.url?.includes('/api/v1/auth/register') &&
      !originalRequest.url?.includes('/api/v1/auth/send-register-code')
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
          // L2：刷新成功但期间已登出，排队请求不得带死 token 重发
          if (!useAuthStore.getState().isAuthenticated) {
            return Promise.reject(new Error('用户已登出，放弃 refresh 重试'))
          }
          // 排队请求重试前同样标记，避免再次 401 时重入刷新循环（H5）
          originalRequest._retry = true
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true
      // M11：等锁起点取本方 401 时刻（略早于此刻），等锁期间他 tab 刷成功即可复用
      const issuedAt = Date.now()

      try {
        // refreshToken 走 httpOnly cookie；同源部署（VITE_API_BASE_URL 为空）时走相对路径经 Vite 代理携带 cookie
        // L31 超时与 M11 跨 tab 单飞均收敛在 refreshAccessToken 内
        const accessToken = await refreshAccessToken(issuedAt)

        // M3：refresh 期间若用户已登出（clearUserScopedState 已执行、isAuthenticated=false），
        // 不得向已清态 store 回写死信 token，也不得重发排队请求——避免死信 token 导致跨用户
        // 数据泄露（react-query staleTime 30s 内旧用户数据可见）。
        if (!useAuthStore.getState().isAuthenticated) {
          // L2：先排空队列再早退，否则排队请求各自等 15s 定时器超时，且后续刷新周期
          // 会把旧队列带去重试死 token。排队回调同样复检登出态（见上方 then 分支）
          const logoutError = new Error('用户已登出，放弃 refresh 重试')
          processQueue(logoutError, null)
          return Promise.reject(logoutError)
        }

        useAuthStore.getState().setToken(accessToken)
        processQueue(null, accessToken)

        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        // M2：must-change 用户 refresh 必 401——跳改密页且不清态（清态会弹回登录页），
        // 与下方终态登出互斥。原判定在 refreshAccessToken 无锁分支内：主路径（Web Locks）
        // 401 直接穿透到此被清态覆盖，双重失效
        const refreshErr = refreshError as AxiosError<{ message?: string } | undefined>
        if (
          refreshErr?.response?.status === 401 &&
          refreshErr.response.data?.message === ErrorMessages[ErrorCodes.MUST_CHANGE_PASSWORD]
        ) {
          if (!window.location.pathname.startsWith('/change-password')) {
            authRedirect.to('/change-password')
          }
          return Promise.reject(refreshError)
        }
        clearUserScopedState()
        authRedirect.to('/login')
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    // L16/M1：refresh 成功但重试仍 401（jti 吊销竞态/Redis 阴性缓存），视为终态登出。
    // 仅限 _retry 重试请求——收窄前无条件吞掉一切 401，登录/注册页输错密码必现整页
    // 重载、错误提示闪现即失（上轮 L16 修复丢条件，本轮 P0 修正）
    if (error.response?.status === 401 && originalRequest?._retry === true) {
      clearUserScopedState()
      authRedirect.to('/login')
    }

    return Promise.reject(error)
  },
)
