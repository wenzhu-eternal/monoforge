import { forwardRef, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { ErrorLogsModule } from '@/modules/error-logs/error-logs.module'
import { MailModule } from '@/modules/mail/mail.module'
import { AuthController } from './auth.controller'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
      global: true,
    }),
    forwardRef(() => MailModule),
    // M2：logout 三段吊销失败需写 error_logs；ErrorLogsModule 反向依赖本模块的 AuthGuard，双向 forwardRef
    forwardRef(() => ErrorLogsModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
