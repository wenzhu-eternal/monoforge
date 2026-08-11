import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { ZodValidationPipe } from 'nestjs-zod'
import { AppModule } from './app.module'
import { RedisIoAdapter } from './common/adapters/redis-io.adapter'
import { SanitizeBodyPipe } from './common/pipes/sanitize-body.pipe'
import { XssPipe } from './common/pipes/xss.pipe'
import { validateEnv } from './config'

async function bootstrap() {
  const env = validateEnv()

  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const configService = app.get(ConfigService)
  const isProduction = configService.get<string>('NODE_ENV') === 'production'
  const appName = env.APP_NAME

  app.setGlobalPrefix('api/v1')

  // 信任反向代理 IP（nginx 等），确保 request.ip 取真实客户端 IP
  app.getHttpAdapter().getInstance().set('trust proxy', 1)

  // 安全: HTTP 安全头；生产环境移除 scriptSrc 'unsafe-inline'，开发环境保留以兼容 Vite HMR + Swagger
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  )

  // Cookie 解析（refreshToken 走 httpOnly cookie）
  app.use(cookieParser())

  const allowedOrigins = configService
    .get<string>('ALLOW_ORIGIN', 'http://localhost:3000')
    .split(',')
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, ok?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        console.warn(`[CORS] blocked origin: ${origin.replace(/[\r\n]/g, '')}`)
        callback(null, false)
      }
    },
    credentials: true,
  })

  // 全局管道: 清洗 null → XSS 清洗 → Zod 校验
  app.useGlobalPipes(new SanitizeBodyPipe(), new XssPipe(), new ZodValidationPipe())

  // ZodSerializerInterceptor 已通过 APP_INTERCEPTOR 在 CommonModule 注册（@Global），无需在此手动 useGlobalInterceptors

  // WebSocket Redis 适配器：多实例部署下通过 Redis pub/sub 同步 WS 事件
  app.useWebSocketAdapter(new RedisIoAdapter(app))

  // Swagger 仅在非生产环境暴露，避免生产泄漏接口文档
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle(`${appName} API`)
      .setDescription(`${appName} 全栈 monorepo API 文档`)
      .setVersion('1.0')
      .addBearerAuth()
      .build()

    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
  }

  // 优雅关闭: SIGTERM/SIGINT 时刷日志 + 关闭 DB
  app.enableShutdownHooks()

  const port = configService.get<number>('API_PORT', 9000)
  await app.listen(port)

  console.log(`Application is running on: http://localhost:${port}`)
  if (!isProduction) {
    console.log(`Swagger docs: http://localhost:${port}/api/docs`)
  }
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] 启动失败:', err)
  process.exit(1)
})
