import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module'
import { RedisModule } from '@/modules/redis/redis.module'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
