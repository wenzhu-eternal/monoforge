import { z } from 'zod'

export const WechatLoginTypeSchema = z.enum(['qrcode', 'miniprogram'])

/**
 * 微信登录请求
 * - qrcode: 扫码登录，code 来自微信 OAuth 重定向
 * - miniprogram: 小程序登录，code 来自 wx.login()
 */
export const WechatLoginSchema = z.object({
  code: z.string().min(1, 'code 不能为空'),
  loginType: WechatLoginTypeSchema,
  state: z.string().optional(),
})

/**
 * 扫码登录返回的二维码信息
 */
export const WechatQrCodeSchema = z.object({
  qrCodeUrl: z.string().url(),
  state: z.string(),
  /** 二维码有效期（秒） */
  expiresIn: z.number().int().positive(),
})

export type WechatLoginType = z.infer<typeof WechatLoginTypeSchema>
