import { Injectable, type PipeTransform } from '@nestjs/common'

/**
 * Body 清洗管道: 将 null / 空字符串转为 undefined
 * 在 ZodValidationPipe 之前执行，使 schema 的 .optional() 能正确匹配前端的 null 值
 */
@Injectable()
export class SanitizeBodyPipe implements PipeTransform {
  transform(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value
    }

    const cleaned: Record<string, unknown> = { ...(value as Record<string, unknown>) }
    for (const [key, val] of Object.entries(cleaned)) {
      if (val === null) {
        cleaned[key] = undefined
      }
    }
    return cleaned
  }
}
