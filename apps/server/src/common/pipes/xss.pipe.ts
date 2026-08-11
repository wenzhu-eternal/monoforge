import { Injectable, type PipeTransform } from '@nestjs/common'
import xss from 'xss'

/**
 * XSS 清洗管道: 递归清洗对象中所有字符串字段
 * 用于 ZodValidationPipe 之前，确保入库数据不含恶意脚本
 */
@Injectable()
export class XssPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return this.sanitize(value)
  }

  private sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
      // 移除所有 HTML 标签（纯文本中的 javascript:/onerror= 不清洗）
      return xss(value, {
        whiteList: {},
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script'],
      })
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item))
    }

    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.sanitize(val)
      }
      return result
    }

    return value
  }
}
