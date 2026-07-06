import { join } from 'node:path'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ServeStaticModule } from '@nestjs/serve-static'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { CommonModule } from './common/common.module'
import { AuditInterceptor } from './common/interceptors/audit.interceptor'
import { DatabaseModule } from './db/database.module'
import { AuditModule } from './modules/audit/audit.module'
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
      // 环境变量校验由 main.ts 中的 validateEnv() 统一负责（zod schema）
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'web', 'dist'),
      exclude: ['/api/{*path}'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
            limit: configService.get<number>('THROTTLE_LIMIT', 10),
          },
        ],
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
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
