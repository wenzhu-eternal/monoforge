import { E2E_API_BASE } from '@e2e/fixtures/users'

/**
 * API 请求辅助：直接打后端 API，绕过前端浏览器
 * 用于 global-setup/teardown 和测试内的数据准备
 */

export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export interface LoginResponse {
  accessToken: string
  user: {
    id: number
    username: string
    email: string
    nickname?: string
    roleId?: number
    status: boolean
    permissions?: string[]
  }
}

export interface PaginatedResponse<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export class ApiClient {
  private token: string | null = null
  private cookies: string[] = []
  // token 复用：避免 e2e 套件内重复登录触发 ThrottlerGuard 限流（60s 内 10 次即限流）
  private lastUsername: string | null = null
  private lastUser: LoginResponse['user'] | null = null
  // L20：登录缓存时间戳，AT TTL=15min，超 10 分钟强制重登防止死 token 导致 401 连锁
  private lastLoginAt = 0
  private static readonly LOGIN_CACHE_TTL_MS = 10 * 60 * 1000

  setToken(token: string) {
    this.token = token
  }

  hasToken(): boolean {
    return this.token !== null
  }

  clearToken() {
    this.token = null
    this.cookies = []
    this.lastUsername = null
    this.lastUser = null
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    // token 复用：同一用户已登录且缓存未过期则跳过（L20：超 10 分钟强制重登，AT TTL=15min）
    if (
      this.token &&
      this.lastUsername === username &&
      this.lastUser &&
      Date.now() - this.lastLoginAt < ApiClient.LOGIN_CACHE_TTL_MS
    ) {
      return { accessToken: this.token, user: this.lastUser }
    }

    const res = await fetch(`${E2E_API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    if (!res.ok) {
      throw new Error(`登录失败 ${res.status}: ${await res.text()}`)
    }

    // 收集 set-cookie（refreshToken）
    this.cookies = res.headers.getSetCookie?.() ?? []

    const json = (await res.json()) as ApiResponse<LoginResponse>
    this.token = json.data.accessToken
    this.lastUsername = username
    this.lastUser = json.data.user
    this.lastLoginAt = Date.now()
    return json.data
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) h.Authorization = `Bearer ${this.token}`
    if (this.cookies.length > 0) h.Cookie = this.cookies.join('; ')
    return h
  }

  async get<T = unknown>(path: string): Promise<{ status: number; data: T }> {
    const res = await fetch(`${E2E_API_BASE}${path}`, {
      headers: this.headers(),
    })
    const body = (await res.json().catch(() => null)) as ApiResponse<T> | null
    // 后端统一响应格式 { code, message, data }，解包 data 字段
    const data = (body?.data ?? null) as T
    return { status: res.status, data }
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    expectedStatus?: number,
  ): Promise<{ status: number; data: T }> {
    const res = await fetch(`${E2E_API_BASE}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    })
    if (expectedStatus && res.status !== expectedStatus) {
      throw new Error(
        `POST ${path} 期望 ${expectedStatus}，实际 ${res.status}: ${await res.text()}`,
      )
    }
    const bodyJson = (await res.json().catch(() => null)) as ApiResponse<T> | null
    const data = (bodyJson?.data ?? null) as T
    return { status: res.status, data }
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${E2E_API_BASE}${path}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    })
    const bodyJson = (await res.json().catch(() => null)) as ApiResponse<T> | null
    const data = (bodyJson?.data ?? null) as T
    return { status: res.status, data }
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${E2E_API_BASE}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    })
    const bodyJson = (await res.json().catch(() => null)) as ApiResponse<T> | null
    const data = (bodyJson?.data ?? null) as T
    return { status: res.status, data }
  }

  async delete<T = unknown>(path: string): Promise<{ status: number; data: T }> {
    const res = await fetch(`${E2E_API_BASE}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
    const bodyJson = (await res.json().catch(() => null)) as ApiResponse<T> | null
    const data = (bodyJson?.data ?? null) as T
    return { status: res.status, data }
  }

  /**
   * 上传文件（multipart/form-data）
   */
  async uploadFile(
    path: string,
    filePath: string,
    filename: string,
    mimeType: string,
  ): Promise<{ status: number; data: unknown }> {
    const fs = await import('node:fs')
    const fileBuffer = fs.readFileSync(filePath)
    const blob = new Blob([fileBuffer], { type: mimeType })

    const form = new FormData()
    form.append('file', blob, filename)

    const res = await fetch(`${E2E_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: this.token ? `Bearer ${this.token}` : '',
      },
      body: form,
    })

    const bodyJson = await res.json().catch(() => null)
    // 解包 { code, message, data }
    const data = (bodyJson as ApiResponse<unknown> | null)?.data ?? bodyJson
    return { status: res.status, data }
  }
}

/** 全局共享 API 客户端（仅 e2e 进程内，不跨进程） */
export const apiClient = new ApiClient()
