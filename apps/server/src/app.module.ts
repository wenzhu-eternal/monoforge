import { join } from 'node:path'
import { Module, OnApplicationShutdown } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ServeStaticModule } from '@nestjs/serve-static'
import { ThrottlerModule } from '@nestjs/throttler'
import { CommonModule } from './common/common.module'
import { CustomThrottlerGuard } from './common/guards/throttler.guard'
import { AuditInterceptor } from './common/interceptors/audit.interceptor'
import { flushErrorLog } from './common/logger'
import { RedisThrottlerStorage } from './common/storage/redis-throttler.storage'
import { DatabaseModule } from './db/database.module'
import { AuditModule } from './modules/audit/audit.module'
import { AuthGuard } from './modules/auth/auth.guard'
import { AuthModule } from './modules/auth/auth.module'
import { CacheModule } from './modules/cache/cache.module'
import { ErrorLogsModule } from './modules/error-logs/error-logs.module'
import { FilesModule } from './modules/files/files.module'
import { HealthModule } from './modules/health/health.module'
import { HttpClientModule } from './modules/http-client/http-client.module'
import { MailModule } from './modules/mail/mail.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PermissionsModule } from './modules/permissions/permissions.module'
import { RedisModule } from './modules/redis/redis.module'
import { RedisService } from './modules/redis/redis.service'
import { RolesModule } from './modules/roles/roles.module'
import { RoutesModule } from './modules/routes/routes.module'
import { ScheduleTasksModule } from './modules/schedule/schedule.module'
import { SetupModule } from './modules/setup/setup.module'
import { UsersModule } from './modules/users/users.module'
import { WebSocketModule } from './modules/websocket/websocket.module'
import { WechatModule } from './modules/wechat/wechat.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 显式指定根目录 .env，避免在 apps/server/ 下运行时找不到
      envFilePath: [join(__dirname, '..', '..', '..', '.env')],
      // 环境变量校验由 main.ts 中的 validateEnv() 统一负责（zod schema）
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'web', 'dist'),
      exclude: ['/api/{*path}'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, RedisService],
      useFactory: (configService: ConfigService, _redisService: RedisService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
            limit: configService.get<number>('THROTTLE_LIMIT', 10),
          },
        ],
        storage: new RedisThrottlerStorage(_redisService),
      }),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisModule,
    CommonModule,
    CacheModule,
    HttpClientModule,
    AuthModule,
    UsersModule,
    RolesModule,
    HealthModule,
    AuditModule,
    ErrorLogsModule,
    FilesModule,
    MailModule,
    NotificationsModule,
    PermissionsModule,
    ScheduleTasksModule,
    WechatModule,
    WebSocketModule,
    SetupModule,
    RoutesModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // 守卫执行顺序：AuthGuard 先执行（设置 request.user）→ CustomThrottlerGuard 按 userId 维度限流
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await flushErrorLog()
  }
}
