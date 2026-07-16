import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PermissionCodes } from '@shared/constants/permissions'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { SendVerificationCodeMailDto, SendWelcomeMailDto } from './dto/mail.dto'
import { MailService } from './mail.service'

@ApiTags('Mail')
@ApiBearerAuth()
@Controller('mail')
@UseGuards(PermissionsGuard)
@Permissions(PermissionCodes.MAIL_SEND)
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('welcome')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送欢迎邮件' })
  async sendWelcome(@Body() dto: SendWelcomeMailDto) {
    if (!this.mailService.isConfigured()) {
      throw new BadRequestException('邮件服务未配置（缺少 MAIL_HOST/PORT/USER/PASSWORD），无法发送')
    }
    await this.mailService.sendWelcome(dto.to, dto.username)
    return { message: `欢迎邮件已发送至 ${dto.to}` }
  }

  @Post('verification-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送验证码邮件' })
  async sendVerificationCode(@Body() dto: SendVerificationCodeMailDto) {
    if (!this.mailService.isConfigured()) {
      throw new BadRequestException('邮件服务未配置（缺少 MAIL_HOST/PORT/USER/PASSWORD），无法发送')
    }
    await this.mailService.sendVerificationCode(dto.to, dto.name)
    return { message: `验证码邮件已发送至 ${dto.to}` }
  }
}
