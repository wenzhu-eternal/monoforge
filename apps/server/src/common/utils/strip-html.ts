import xss from 'xss'

/**
 * 与全局 XssPipe 同款规则（whiteList 空 = 剥除全部 HTML 标签）。
 * 供 HTTP 管道外的入库路径复用（如微信昵称/头像），保证管道内外清洗口径一致（L19）
 */
export function stripHtml(value: string): string {
  return xss(value, { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script'] })
}
