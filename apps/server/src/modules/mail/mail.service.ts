import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Handlebars from 'handlebars'
import { createTransport, type Transporter } from 'nodemailer'

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private transporter: Transporter | null = null
  private fromAddress: string
  private templates: Map<string, HandlebarsTemplateDelegate> = new Map()

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST')
    const port = this.configService.get<number>('MAIL_PORT')
    const user = this.configService.get<string>('MAIL_USER')
    const password = this.configService.get<string>('MAIL_PASSWORD')
    this.fromAddress = this.configService.get<string>('MAIL_FROM') ?? user ?? ''

    if (host && port && user && password) {
      this.transporter = createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass: password },
      })
      this.logger.log('邮件服务已初始化')
    } else {
      this.logger.warn('邮件服务未配置（缺少 MAIL_HOST/PORT/USER/PASSWORD），相关功能将跳过')
    }

    this.loadTemplates()
  }

  private loadTemplates(): void {
    const templateDir = join(__dirname, 'templates', 'email')
    const templateNames = ['welcome', 'verification', 'backup']

    for (const name of templateNames) {
      try {
        const content = readFileSync(join(templateDir, `${name}.hbs`), 'utf-8')
        this.templates.set(name, Handlebars.compile(content))
      } catch {
        this.logger.warn(`邮件模板 ${name}.hbs 加载失败`)
      }
    }
  }

  /**
   * 发送欢迎邮件（HTML 模板）
   */
  async sendWelcome(to: string, username: string): Promise<void> {
    const template = this.templates.get('welcome')
    if (template) {
      await this.sendHtml(to, '欢迎注册 MB Admin', template({ name: username }))
    } else {
      await this.send(
        to,
        '欢迎注册 MB Admin',
        `你好，${username}！欢迎注册 MB Admin 系统管理后台。`,
      )
    }
  }

  /**
   * 发送验证码邮件（HTML 模板）
   */
  async sendVerificationCode(to: string, code: string, name?: string): Promise<void> {
    const template = this.templates.get('verification')
    if (template) {
      await this.sendHtml(
        to,
        '【MB Admin】验证码',
        template({ name: name ?? '用户', code, expireMinutes: 5 }),
      )
    } else {
      await this.send(
        to,
        '【MB Admin】验证码',
        `你的验证码是: ${code}\n\n验证码 5 分钟内有效，请勿泄露给他人。`,
      )
    }
  }

  /**
   * 发送备份通知邮件（HTML 模板）
   */
  async sendBackupNotification(
    success: boolean,
    detail: string,
    backupDate?: string,
  ): Promise<void> {
    const subject = success ? '【MB Admin】数据库备份成功' : '【MB Admin】数据库备份失败'
    const template = this.templates.get('backup')
    if (template) {
      await this.sendHtml(
        this.fromAddress,
        subject,
        template({
          name: '管理员',
          backupDate: backupDate ?? new Date().toLocaleDateString('zh-CN'),
        }),
      )
    } else {
      const status = success ? '成功' : '失败'
      await this.send(this.fromAddress, subject, `数据库备份${status}\n\n详情: ${detail}`)
    }
  }

  /**
   * 判断邮件服务是否已配置（供 Controller 检查并返回友好提示）
   */
  isConfigured(): boolean {
    return this.transporter !== null
  }

  /**
   * 发送 HTML 邮件
   */
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
    }
  }

  /**
   * 底层发送方法: 若 transporter 未初始化则跳过并打印日志
   */
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
    }
  }
}
