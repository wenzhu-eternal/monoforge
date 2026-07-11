import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { WechatLoginType } from '@shared/schemas/wechat'
import type { AxiosInstance } from 'axios'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, notDeleted } from '@/db/helpers'
import { users } from '@/db/schema'
import { AuthService, type TokenPayload } from '@/modules/auth/auth.service'
import { HttpClientService } from '@/modules/http-client/http-client.service'
import { RedisService } from '@/modules/redis/redis.service'

// 微信 API 响应结构
interface WechatAccessTokenResponse {
  access_token: string
  expires_in: number
  refresh_token: string
  openid: string
  scope: string
  unionid?: string
  errcode?: number
  errmsg?: string
}

interface WechatUserInfoResponse {
  openid: string
  nickname: string
  sex: number
  province: string
  city: string
  country: string
  headimgurl: string
  unionid?: string
  errcode?: number
  errmsg?: string
}

interface WechatCode2SessionResponse {
  openid: string
  session_key: string
  unionid?: string
  errcode?: number
  errmsg?: string
}

/**
 * 微信登录服务
 * - 扫码登录: 网站应用 OAuth2.0 (open.weixin.qq.com)
 * - 小程序登录: wx.login() → code2Session
 *
 * state 缓存到 Redis 用于扫码后回调校验，TTL 5 分钟
 */
@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name)
  private readonly qrcodeInstance: AxiosInstance
  private readonly miniprogramInstance: AxiosInstance
  private readonly appid?: string
  private readonly secret?: string
  private readonly enabled: boolean

  // state 在 Redis 中保留 5 分钟
  private static readonly STATE_TTL = 300

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClient: HttpClientService,
    private readonly redisService: RedisService,
    private readonly authService: AuthService,
  ) {
    this.appid = this.configService.get<string>('WEAPP_APPID')
    this.secret = this.configService.get<string>('WEAPP_SECRET')
    this.enabled = !!(this.appid && this.secret)

    // 网站扫码登录用 api.weixin.qq.com/sns/...
    this.qrcodeInstance = this.httpClient.createInstance({
      baseURL: 'https://api.weixin.qq.com',
      timeout: 10000,
      maxRetries: 2,
    })

    // 小程序 code2Session 用 api.weixin.qq.com/sns/jscode2session
    this.miniprogramInstance = this.httpClient.createInstance({
      baseURL: 'https://api.weixin.qq.com',
      timeout: 10000,
      maxRetries: 2,
    })
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 生成扫码登录二维码 URL 与 state
   * 网站应用: https://open.weixin.qq.com/connect/qrconnect
   */
  async getQrCode(): Promise<{ qrCodeUrl: string; state: string; expiresIn: number }> {
    this.requireEnabled()

    const state = randomUUID()
    // 缓存 state，回调时校验，防 CSRF
    await this.redisService.set(`wechat:state:${state}`, '1', WechatService.STATE_TTL)

    const redirectUri = this.configService.get<string>('WECHAT_REDIRECT_URI') ?? ''
    const qrCodeUrl = new URL('https://open.weixin.qq.com/connect/qrconnect')
    qrCodeUrl.searchParams.set('appid', this.appid!)
    qrCodeUrl.searchParams.set('redirect_uri', redirectUri)
    qrCodeUrl.searchParams.set('response_type', 'code')
    qrCodeUrl.searchParams.set('scope', 'snsapi_login')
    qrCodeUrl.searchParams.set('state', state)

    return {
      qrCodeUrl: qrCodeUrl.toString(),
      state,
      expiresIn: WechatService.STATE_TTL,
    }
  }

  /**
   * 微信登录入口
   * - qrcode: 用 code 换 access_token + openid + 用户信息
   * - miniprogram: 用 code 调 code2Session 拿 openid
   * 然后查/建用户，签发 JWT
   */
  async login(
    code: string,
    loginType: WechatLoginType,
  ): Promise<{
    accessToken: string
    refreshToken: string
    user: { id: number; username: string; nickname?: string | null; avatar?: string | null }
  }> {
    this.requireEnabled()

    let openId: string
    let nickname: string | undefined
    let avatar: string | undefined

    if (loginType === 'qrcode') {
      const tokenResp = await this.getAccessTokenByCode(code)
      openId = tokenResp.openid
      const userInfo = await this.getUserInfo(tokenResp.access_token, openId)
      nickname = userInfo.nickname
      avatar = userInfo.headimgurl
    } else {
      const session = await this.code2Session(code)
      openId = session.openid
    }

    if (!openId) {
      throw new UnauthorizedException('微信登录失败: 未获取到 openId')
    }

    const user = await this.findOrCreateUser(openId, nickname, avatar)
    const payload: TokenPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
    }
    const tokens = await this.authService.signTokenPair(payload)
    // refreshToken 也存 Redis 便于吊销
    await this.authService.storeRefreshTokenForExternal(tokens.refreshToken, user.id)

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
      },
    }
  }

  private async getAccessTokenByCode(code: string): Promise<WechatAccessTokenResponse> {
    const url = `/sns/oauth2/access_token?appid=${this.appid}&secret=${this.secret}&code=${code}&grant_type=authorization_code`
    const data = await this.httpClient.get<WechatAccessTokenResponse>(this.qrcodeInstance, url)
    if (data.errcode) {
      this.logger.error(`微信获取 access_token 失败: ${data.errcode} ${data.errmsg}`)
      throw new UnauthorizedException(`微信登录失败: ${data.errmsg ?? 'access_token 获取失败'}`)
    }
    return data
  }

  private async getUserInfo(accessToken: string, openId: string): Promise<WechatUserInfoResponse> {
    const url = `/sns/userinfo?access_token=${accessToken}&openid=${openId}&lang=zh_CN`
    const data = await this.httpClient.get<WechatUserInfoResponse>(this.qrcodeInstance, url)
    if (data.errcode) {
      this.logger.error(`微信获取用户信息失败: ${data.errcode} ${data.errmsg}`)
      throw new UnauthorizedException(`微信登录失败: ${data.errmsg ?? '用户信息获取失败'}`)
    }
    return data
  }

  private async code2Session(code: string): Promise<WechatCode2SessionResponse> {
    const url = `/sns/jscode2session?appid=${this.appid}&secret=${this.secret}&js_code=${code}&grant_type=authorization_code`
    const data = await this.httpClient.get<WechatCode2SessionResponse>(
      this.miniprogramInstance,
      url,
    )
    if (data.errcode) {
      this.logger.error(`微信 code2Session 失败: ${data.errcode} ${data.errmsg}`)
      throw new UnauthorizedException(`小程序登录失败: ${data.errmsg ?? 'code2Session 失败'}`)
    }
    return data
  }

  /**
   * 查/建用户: openId 已存在则返回，不存在则建（用户名 wx_{openId 前 8 位}，邮箱占位符）
   */
  private async findOrCreateUser(openId: string, nickname?: string, avatar?: string) {
    const existing = await db.query.users.findFirst({
      where: and(eq(users.wechatOpenId, openId), notDeleted(users.deletedAt)),
    })

    if (existing) {
      // 顺便更新昵称/头像（微信侧可能变更）
      const needUpdate =
        (nickname && existing.nickname !== nickname) || (avatar && existing.avatar !== avatar)
      if (needUpdate) {
        const [updated] = await db
          .update(users)
          .set({
            nickname: nickname ?? existing.nickname,
            avatar: avatar ?? existing.avatar,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning()
        return updated ?? existing
      }
      return existing
    }

    // 新建微信用户
    const username = `wx_${openId.slice(0, 8)}`
    const email = `${username}@wechat.placeholder`
    try {
      const [newUser] = await db
        .insert(users)
        .values({
          username,
          email,
          password: randomUUID(), // 占位符，微信用户不可走密码登录
          nickname: nickname ?? `微信用户_${openId.slice(0, 6)}`,
          avatar,
          wechatOpenId: openId,
        })
        .returning()

      if (!newUser) {
        throw new BadRequestException('微信用户创建失败')
      }
      return newUser
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('微信账号已存在，请直接登录')
      }
      throw error
    }
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('微信登录未启用，请配置 WEAPP_APPID 与 WEAPP_SECRET')
    }
  }
}
