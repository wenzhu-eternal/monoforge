import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '@/common/decorators/roles.decorator'
import { RolesGuard } from '@/common/guards/roles.guard'
import { ScheduleService } from './schedule.service'

@ApiTags('Schedule')
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post('backup')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动触发数据库备份（仅管理员）' })
  async triggerBackup() {
    await this.scheduleService.dailyBackup()
    return { message: '备份任务已执行，请查看日志和邮件' }
  }
}
