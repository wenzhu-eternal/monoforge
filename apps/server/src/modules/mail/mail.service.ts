import { randomInt } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import Handlebars from 'handlebars'
import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer'
import { getEnv } from '@/config'

type Attachment = NonNullable<SendMailOptions['attachments']>[number]

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private transporter: Transporter | null = null
  private fromAddress: string
  private appName: string
  private templates: Map<string, HandlebarsTemplateDelegate> = new Map()

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST')
    const portRaw = this.configService.get<string>('MAIL_PORT')
    const port = portRaw ? Number(portRaw) : undefined
    const user = this.configService.get<string>('MAIL_USER')
    const password = this.configService.get<string>('MAIL_PASSWORD')
    this.fromAddress = this.configService.get<string>('MAIL_FROM') ?? user ?? ''
    this.appName = getEnv().APP_NAME

    if (host && port && user && password) {
      this.transporter = createTransport({
        host,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user, pass: password },
      })
      this.logger.log('邮件服务已初始化')
    } else {
      this.logger.warn('邮件服务未配置（缺少 MAIL_HOST/PORT/USER/PASSWORD），相关功能将跳过')
    }

    this.loadTemplates()
  }

  private loadTemplates(): void {
    // __dirname 在 dev 时为 src/modules/mail/，prod 时为 dist/modules/mail/
    // 两种场景下 ../../templates/email 都指向正确的模板目录
    const templateDir = join(__dirname, '..', '..', 'templates', 'email')
    const templateNames = ['welcome', 'verification', 'backup']

    for (const name of templateNames) {
      try {
        const content = readFileSync(join(templateDir, `${name}.hbs`), 'utf-8')
        this.templates.set(name, Handlebars.compile(content))
      } catch {
        this.logger.warn(`邮件模板 ${name}.hbs 加载失败，将使用纯文本 fallback`)
      }
    }
    this.logger.log(`已加载 ${this.templates.size} 个邮件模板`)
  }

  async sendWelcome(to: string, username: string): Promise<void> {
    const template = this.templates.get('welcome')
    if (template) {
      await this.sendHtml(
        to,
        `欢迎注册 ${this.appName}`,
        template({ name: username, appName: this.appName }),
      )
    } else {
      await this.send(
        to,
        `欢迎注册 ${this.appName}`,
        `你好，${username}！欢迎注册 ${this.appName} 系统管理后台。`,
      )
    }
  }

  /**
   * 发送验证码邮件（HTML 模板）
   * @param code 外部传入验证码（如注册流程由 auth.service 生成并存 Redis）。不传则内部随机生成（如邮件测试接口）
   */
  async sendVerificationCode(to: string, name?: string, code?: string): Promise<void> {
    const finalCode = code ?? randomInt(0, 999999).toString().padStart(6, '0')
    const template = this.templates.get('verification')
    if (template) {
      await this.sendHtml(
        to,
        `【${this.appName}】验证码`,
        template({
          name: name ?? '用户',
          appName: this.appName,
          code: finalCode,
          expireMinutes: 5,
        }),
      )
    } else {
      await this.send(
        to,
        `【${this.appName}】验证码`,
        `你的验证码是: ${finalCode}\n\n验证码 5 分钟内有效，请勿泄露给他人。`,
      )
    }
  }

  /**
   * 发送备份通知邮件（成功时附带 .sql 备份文件作为附件）
   */
  async sendBackupNotification(
    success: boolean,
    detail: string,
    backupDate?: string,
    filepath?: string,
  ): Promise<void> {
    const subject = success
      ? `【${this.appName}】数据库备份成功`
      : `【${this.appName}】数据库备份失败`
    const template = this.templates.get('backup')
    const html = template
      ? template({
          name: '管理员',
          appName: this.appName,
          backupDate: backupDate ?? new Date().toLocaleDateString('zh-CN'),
        })
      : undefined

    const attachments: Attachment[] = []
    if (success && filepath && existsSync(filepath)) {
      attachments.push({
        filename: basename(filepath),
        path: filepath,
        contentType: 'application/sql',
      })
    }

    const text = `数据库备份${success ? '成功' : '失败'}\n\n详情: ${detail}`

    if (html) {
      await this.sendWithAttachments(this.fromAddress, subject, html, text, attachments)
    } else {
      await this.sendWithAttachments(this.fromAddress, subject, undefined, text, attachments)
    }
  }

  /**
   * 判断邮件服务是否已配置（供 Controller 检查并返回友好提示）
   */
  isConfigured(): boolean {
    return this.transporter !== null
  }

  /**
   * 发送带附件的邮件（html 和 text 至少传一个）
   */
  private async sendWithAttachments(
    to: string,
    subject: string,
    html: string | undefined,
    text: string,
    attachments: Attachment[] = [],
  ): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`邮件服务未配置，跳过发送: ${subject} -> ${to}`)
      return
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        html,
        text,
        attachments,
      })
      const attachInfo = attachments.length > 0 ? ` (${attachments.length} 个附件)` : ''
      this.logger.log(`邮件已发送: ${subject} -> ${to}${attachInfo}`)
    } catch (err) {
      this.logger.error(`邮件发送失败: ${subject} -> ${to}`, err)
      throw new ServiceUnavailableException(ErrorMessages[ErrorCodes.MAIL_SEND_FAILED])
    }
  }

  private async sendHtml(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`邮件服务未配置，跳过发送: ${subject} -> ${to}`)
      return
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        html,
      })
      this.logger.log(`邮件已发送: ${subject} -> ${to}`)
    } catch (err) {
      this.logger.error(`邮件发送失败: ${subject} -> ${to}`, err)
      throw new ServiceUnavailableException(ErrorMessages[ErrorCodes.MAIL_SEND_FAILED])
    }
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`邮件服务未配置，跳过发送: ${subject} -> ${to}`)
      return
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        text,
      })
      this.logger.log(`邮件已发送: ${subject} -> ${to}`)
    } catch (err) {
      this.logger.error(`邮件发送失败: ${subject} -> ${to}`, err)
      throw new ServiceUnavailableException(ErrorMessages[ErrorCodes.MAIL_SEND_FAILED])
    }
  }
}
