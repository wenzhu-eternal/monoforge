import { Injectable, Logger } from '@nestjs/common'
import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'

export interface HttpClientOptions {
  baseURL?: string
  timeout?: number
  /** 最大重试次数（不含首次），默认 2 */
  maxRetries?: number
  /** 重试基础延迟（毫秒），指数退避 base * 2^attempt，默认 300 */
  retryBaseDelay?: number
  /** 自定义 headers */
  headers?: Record<string, string>
}

export interface RequestOptions {
  /** 临时覆盖重试次数 */
  maxRetries?: number
  /** 仅对 5xx 与网络错误重试（默认 true） */
  retryOn5xx?: boolean
}

interface RetryableConfig extends InternalAxiosRequestConfig {
  __retryCount?: number
  __maxRetries?: number
  __retryBaseDelay?: number
  __retryOn5xx?: boolean
}

/**
 * HTTP 客户端封装: 用于调用外部 API（微信、支付、短信等）
 * - 超时控制
 * - 指数退避重试（仅 5xx 与网络错误）
 */
@Injectable()
export class HttpClientService {
  private readonly logger = new Logger(HttpClientService.name)
  private readonly defaultMaxRetries: number
  private readonly defaultRetryBaseDelay: number

  constructor() {
    this.defaultMaxRetries = 2
    this.defaultRetryBaseDelay = 300
  }

  /**
   * 创建一个独立的 axios 实例（每个外部服务建议建一个）
   */
  createInstance(options: HttpClientOptions = {}): AxiosInstance {
    const instance = axios.create({
      baseURL: options.baseURL,
      timeout: options.timeout ?? 10000,
      headers: options.headers,
    })

    const maxRetries = options.maxRetries ?? this.defaultMaxRetries
    const retryBaseDelay = options.retryBaseDelay ?? this.defaultRetryBaseDelay

    // 请求拦截: 注入重试元数据（仅首次请求，重试时 __retryCount 已存在则保留）
    instance.interceptors.request.use((config) => {
      const cfg = config as RetryableConfig
      if (cfg.__retryCount === undefined) {
        cfg.__retryCount = 0
      }
      cfg.__maxRetries = maxRetries
      cfg.__retryBaseDelay = retryBaseDelay
      const method = (cfg.method ?? 'get').toLowerCase()
      cfg.__retryOn5xx = method === 'get' || method === 'head'
      return cfg
    })

    // 响应拦截: 错误时按指数退避重试
    instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config as RetryableConfig | undefined
        if (!config) {
          return Promise.reject(error)
        }

        const isNetworkError = !error.response
        const is5xx = error.response?.status && error.response.status >= 500
        const retryOn5xx = config.__retryOn5xx !== false

        const canRetry =
          config.__retryCount !== undefined &&
          config.__maxRetries !== undefined &&
          config.__retryCount < config.__maxRetries &&
          (isNetworkError || (retryOn5xx && is5xx))

        if (!canRetry) {
          return Promise.reject(error)
        }

        config.__retryCount = (config.__retryCount ?? 0) + 1
        const attempt = config.__retryCount
        const delay = (config.__retryBaseDelay ?? 300) * 2 ** (attempt - 1)
        this.logger.warn(
          `请求失败 (${isNetworkError ? '网络错误' : `HTTP ${error.response.status}`})，` +
            `${delay}ms 后第 ${config.__retryCount} 次重试`,
        )

        await new Promise((resolve) => setTimeout(resolve, delay))
        return instance.request(config)
      },
    )

    return instance
  }

  async get<T = unknown>(
    instance: AxiosInstance,
    url: string,
    config?: AxiosRequestConfig & RequestOptions,
  ): Promise<T> {
    const response = await instance.get<T>(url, this.withRetryConfig(config))
    return response.data
  }

  async post<T = unknown>(
    instance: AxiosInstance,
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig & RequestOptions,
  ): Promise<T> {
    const response = await instance.post<T>(url, data, this.withRetryConfig(config))
    return response.data
  }

  /**
   * 拿到完整 AxiosResponse（含 status/headers）
   */
  async raw<T = unknown>(
    instance: AxiosInstance,
    config: AxiosRequestConfig & RequestOptions,
  ): Promise<AxiosResponse<T>> {
    return instance.request<T>(this.withRetryConfig(config))
  }

  private withRetryConfig(config?: AxiosRequestConfig & RequestOptions): AxiosRequestConfig {
    if (!config) return {}
    // RequestOptions 是自定义字段，从 AxiosRequestConfig 中剔除
    const { maxRetries, retryOn5xx, ...axiosConfig } = config
    const merged = { ...axiosConfig } as AxiosRequestConfig & RetryableConfig
    if (maxRetries !== undefined) merged.__maxRetries = maxRetries
    if (retryOn5xx !== undefined) merged.__retryOn5xx = retryOn5xx
    return merged
  }
}
