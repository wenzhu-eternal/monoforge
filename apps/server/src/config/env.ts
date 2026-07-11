import { z } from 'zod'

const envSchema = z
  .object({
    // Database
    DATABASE_URL: z.string().url(),

    // Redis (optional，未接入使用时可不配置)
    REDIS_URL: z.string().url().optional(),

    // JWT: 强制 32 字符以上，防止弱密钥
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),

    // API
    API_PORT: z.coerce.number().default(9000),
    API_PREFIX: z.string().default('/api/v1'),

    // CORS
    ALLOW_ORIGIN: z.string().default('http://localhost:3000'),

    // Cookie: 字符串 "true"/"false" 正确转 boolean（z.coerce.boolean() 对非空字符串恒为 true，有 bug）
    COOKIE_SECURE: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || v === 'true')
      .default(false),

    // Mail (optional)
    MAIL_HOST: z.string().optional(),
    MAIL_PORT: z.coerce.number().optional(),
    MAIL_USER: z.string().optional(),
    MAIL_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().optional(),

    // WeApp (optional)
    WEAPP_APPID: z.string().optional(),
    WEAPP_SECRET: z.string().optional(),
    // 微信扫码登录回调地址（网站应用 OAuth）
    WECHAT_REDIRECT_URI: z.string().url().optional(),

    // Throttle: 登录接口建议单独更严格限流
    THROTTLE_TTL: z.coerce.number().default(60),
    THROTTLE_LIMIT: z.coerce.number().default(10),

    // Node env
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .superRefine((data, ctx) => {
    // 生产环境强制 COOKIE_SECURE，避免 refresh cookie 被明文截获
    if (data.NODE_ENV === 'production' && !data.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: '生产环境必须启用 COOKIE_SECURE=true',
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
    console.error('❌ Invalid environment variables:')
    console.error(result.error.flatten().fieldErrors)
    process.exit(1)
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
