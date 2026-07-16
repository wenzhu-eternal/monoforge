import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'
import { AppModule } from './app.module'
import { SanitizeBodyPipe } from './common/pipes/sanitize-body.pipe'
import { XssPipe } from './common/pipes/xss.pipe'
import { validateEnv } from './config'

async function bootstrap() {
  validateEnv()

  const app = await NestFactory.create(AppModule)
  const configService = app.get(ConfigService)
  const isProduction = configService.get<string>('NODE_ENV') === 'production'

  app.setGlobalPrefix('api/v1')

  // 安全: HTTP 安全头（CSP 放宽以兼容 SPA + Swagger）
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
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
        console.warn(`[CORS] blocked origin: ${origin}`)
        callback(null, false)
      }
    },
    credentials: true,
  })

  // 全局管道: 清洗 null/空字符串 → Zod 校验 → XSS 清洗
  app.useGlobalPipes(new SanitizeBodyPipe(), new ZodValidationPipe(), new XssPipe())

  // 全局拦截器: Zod 序列化响应（配合 @ZodSerializerDto 在 controller 上声明输出 schema）
  app.useGlobalInterceptors(app.get(ZodSerializerInterceptor))

  // Swagger 仅在非生产环境暴露，避免生产泄漏接口文档
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('MonoForge API')
      .setDescription('MonoForge 全栈 monorepo API 文档')
      .setVersion('1.0')
      .addBearerAuth()
      .build()

    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
  }

  // 优雅关闭: SIGTERM 时清理 DB 连接
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
