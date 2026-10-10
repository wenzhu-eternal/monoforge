import { Module } from '@nestjs/common'
import { ErrorLogsModule } from '@/modules/error-logs/error-logs.module'
import { FilesModule } from '@/modules/files/files.module'
import { MailModule } from '@/modules/mail/mail.module'
import { ScheduleController } from './schedule.controller'
import { ScheduleService } from './schedule.service'

@Module({
  imports: [MailModule, ErrorLogsModule, FilesModule],
  providers: [ScheduleService],
  controllers: [ScheduleController],
})
export class ScheduleTasksModule {}
