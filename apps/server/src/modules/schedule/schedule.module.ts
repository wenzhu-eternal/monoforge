import { Module } from '@nestjs/common'
import { ErrorLogsModule } from '@/modules/error-logs/error-logs.module'
import { MailModule } from '@/modules/mail/mail.module'
import { ScheduleService } from './schedule.service'

@Module({
  imports: [MailModule, ErrorLogsModule],
  providers: [ScheduleService],
})
export class ScheduleTasksModule {}
