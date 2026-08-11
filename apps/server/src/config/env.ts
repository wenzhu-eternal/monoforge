import { z } from 'zod'

// JWT 密钥黑名单：拒绝 .env.example 的占位符，防止部署人 cp 后不改密钥导致生产用公开密钥
const FORBIDDEN_JWT_SECRETS = new Set([
  'REPLACE_ME_WITH_RANDOM_SECRET_AT_LEAST_32_CHARS',
  'REPLACE_ME_WITH_RANDOM_REFRESH_SECRET_AT_LEAST_32_CHARS',
  'your-super-secret-jwt-key-change-in-production-32chars',
  'your-super-secret-refresh-key-change-in-production-32chars',
])

const jwtSecretSchema = z
  .string()
  .min(32)
  .refine(
    (v) => !FORBIDDEN_JWT_SECRETS.has(v),
    'JWT 密钥不能使用 .env.example 的占位符，请用 openssl rand -base64 48 生成真实密钥',
  )

const envSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (url) => url.startsWith('postgresql://') || url.startsWith('postgres://'),
        'DATABASE_URL 必须为 postgresql 协议',
      ),

    // Redis: auth/权限缓存/限流计数强依赖，必填
    REDIS_URL: z.string().url(),
    // Redis 密码（当前 optional 且代码未直接消费，密码通过 REDIS_URL 传递；此处保留供文档参考）
    REDIS_PASSWORD: z.string().optional(),

    // JWT: 强制 32 字符以上 + 黑名单拒绝占位符，防止弱密钥
    JWT_SECRET: jwtSecretSchema,
    JWT_REFRESH_SECRET: jwtSecretSchema,

    API_PORT: z.coerce.number().min(1).max(65535).default(9000),
    API_PREFIX: z.string().default('/api/v1'),

    // 应用名（Swagger 标题、邮件主题、邮件模板均引用，新项目通过 .env 配置）
    APP_NAME: z.string().default('MonoForge'),

    ALLOW_ORIGIN: z.string().default('http://localhost:3000'),

    // Cookie: 字符串 "true"/"false" 正确转 boolean（z.coerce.boolean() 对非空字符串恒为 true，有 bug）
    COOKIE_SECURE: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || v === 'true')
      .default(false),
    // 显式允许不安全 cookie（仅 ngrok/单容器 HTTP 调试场景；为 true 时生产可不强制 COOKIE_SECURE）
    ALLOW_INSECURE_COOKIE: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || v === 'true')
      .default(false),

    MAIL_HOST: z.string().optional(),
    MAIL_PORT: z.coerce.number().optional(),
    MAIL_USER: z.string().optional(),
    MAIL_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().optional(),

    WEAPP_APPID: z.string().optional(),
    WEAPP_SECRET: z.string().optional(),
    // 微信扫码登录回调地址（网站应用 OAuth）
    WECHAT_REDIRECT_URI: z.string().url().optional(),

    // Throttle: 登录接口建议单独更严格限流
    THROTTLE_TTL: z.coerce.number().min(1).default(60),
    THROTTLE_LIMIT: z.coerce.number().min(1).default(10),

    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // 初始化开关：默认关闭，仅首次部署显式打开
    ALLOW_SETUP: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || v === 'true')
      .default(false),

    // admin 角色 ID（permissions.guard 根据此值判断超级管理员，默认 1）
    ADMIN_ROLE_ID: z.coerce.number().int().positive().default(1),
  })
  .superRefine((data, ctx) => {
    // JWT 双密钥不可相同：相同值会导致 refresh 泄露即可伪造 access
    if (data.JWT_SECRET === data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        message: 'JWT_SECRET 与 JWT_REFRESH_SECRET 不能相同',
        path: ['JWT_REFRESH_SECRET'],
      })
    }
    // 生产环境强制 COOKIE_SECURE，除非显式声明允许不安全（ngrok/单容器 HTTP 调试）
    if (data.NODE_ENV === 'production' && !data.COOKIE_SECURE && !data.ALLOW_INSECURE_COOKIE) {
      ctx.addIssue({
        code: 'custom',
        message:
          '生产环境必须启用 COOKIE_SECURE=true，否则 refresh cookie 明文传输可被截获；' +
          '若为 ngrok/单容器 HTTP 调试场景，请显式设置 ALLOW_INSECURE_COOKIE=true',
        path: ['COOKIE_SECURE'],
      })
    }
  })

export type Env = z.infer<typeof envSchema>

let validatedEnv: Env | null = null

export function validateEnv() {
  if (validatedEnv) {
    return validatedEnv
  }

  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors
    console.error('❌ Invalid environment variables:', errors)
    throw new Error(`环境变量校验失败: ${JSON.stringify(errors)}`)
  }

  validatedEnv = result.data
  return validatedEnv
}

export function getEnv() {
  if (!validatedEnv) {
    return validateEnv()
  }
  return validatedEnv
}
