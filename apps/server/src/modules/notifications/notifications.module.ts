import { Module } from '@nestjs/common'
import { RedisModule } from '@/modules/redis/redis.module'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

@Module({
  controllers: [NotificationsController],
  imports: [RedisModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
