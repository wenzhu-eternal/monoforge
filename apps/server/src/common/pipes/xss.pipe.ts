import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SKIP_XSS_KEY } from '@/common/decorators/skip-xss.decorator'
import { stripHtml } from '@/common/utils/strip-html'

/**
 * XSS 清洗管道: 递归清洗对象中所有字符串字段
 * 用于 ZodValidationPipe 之前，确保入库数据不含恶意脚本
 */
@Injectable()
export class XssPipe implements PipeTransform {
  // 全局管道经 useGlobalPipes 手动注册，Reflector 由 main.ts 从 app 实例取出注入
  constructor(private readonly reflector: Reflector) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // L8：@SkipXss() 标注的 DTO 跳过清洗（错误上报/白名单 pattern 需原文入库，
    // 这些字段无渲染面且前端 React 默认转义）
    const metatype = metadata?.metatype as (new (...args: never[]) => unknown) | undefined
    if (metatype && this.reflector.get(SKIP_XSS_KEY, metatype)) {
      return value
    }
    return this.sanitize(value)
  }

  private sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
      // 移除所有 HTML 标签（纯文本中的 javascript:/onerror= 不清洗）
      return stripHtml(value)
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
