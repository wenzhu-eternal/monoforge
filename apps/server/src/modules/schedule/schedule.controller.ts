import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PermissionCodes } from '@shared/constants/permissions'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { ScheduleService } from './schedule.service'

@ApiTags('Schedule')
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post('backup')
  @UseGuards(PermissionsGuard)
  @ApiBearerAuth()
  @Permissions(PermissionCodes.SCHEDULE_BACKUP)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动触发数据库备份（需 schedule:backup 权限）' })
  async triggerBackup(@CurrentUser() user: { sub: number }) {
    await this.scheduleService.manualBackup(user.sub)
    return { message: '备份任务已执行，请查看日志和邮件' }
  }
}
