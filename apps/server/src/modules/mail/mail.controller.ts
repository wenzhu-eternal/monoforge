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
import { Roles } from '@/common/decorators/roles.decorator'
import { RolesGuard } from '@/common/guards/roles.guard'
import { AuthGuard } from '@/modules/auth/auth.guard'
import { SendVerificationCodeMailDto, SendWelcomeMailDto } from './dto/mail.dto'
import { MailService } from './mail.service'

@ApiTags('Mail')
@ApiBearerAuth()
@Controller('mail')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('welcome')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送欢迎邮件（仅管理员）' })
  async sendWelcome(@Body() dto: SendWelcomeMailDto) {
    if (!this.mailService.isConfigured()) {
      throw new BadRequestException('邮件服务未配置（缺少 MAIL_HOST/PORT/USER/PASSWORD），无法发送')
    }
    await this.mailService.sendWelcome(dto.to, dto.username)
    return { message: `欢迎邮件已发送至 ${dto.to}` }
  }

  @Post('verification-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送验证码邮件（仅管理员）' })
  async sendVerificationCode(@Body() dto: SendVerificationCodeMailDto) {
    if (!this.mailService.isConfigured()) {
      throw new BadRequestException('邮件服务未配置（缺少 MAIL_HOST/PORT/USER/PASSWORD），无法发送')
    }
    await this.mailService.sendVerificationCode(dto.to, dto.name)
    return { message: `验证码邮件已发送至 ${dto.to}` }
  }
}
