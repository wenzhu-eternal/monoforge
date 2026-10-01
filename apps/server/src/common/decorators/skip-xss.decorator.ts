import { SetMetadata } from '@nestjs/common'

export const SKIP_XSS_KEY = 'xss:skip'

/**
 * L8：标注在 DTO 类上，全局 XssPipe 对该 DTO 的 body 跳过 HTML 剥除。
 * 仅用于"原文必须如实入库且无渲染面"的字段（错误上报文案、白名单 pattern）——
 * 全局无差别剥 HTML 会让含 <script 字样的真实报错入库失真、白名单规则永远匹配不上。
 */
export const SkipXss = () => SetMetadata(SKIP_XSS_KEY, true)
