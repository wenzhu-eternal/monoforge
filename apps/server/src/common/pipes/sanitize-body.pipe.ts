import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common'

/** nestjs-zod DTO 的静态形态（isZodDto + schema），duck-type 检测避免依赖未导出的 isZodDto */
type ZodDtoMetatype = {
  isZodDto?: boolean
  schema?: { shape?: Record<string, { safeParse: (v: unknown) => { success: boolean } }> }
}

/**
 * Body 清洗管道: 将 null 转为 undefined
 * 在 ZodValidationPipe 之前执行，使 schema 的 .optional() 能正确匹配前端的 null 值
 * H2（2026-10-08）：schema 允许 null 的字段（如 UpdateUserSchema.roleId 的 .nullable()）
 * 保留原值——否则"清空角色"的 null 被吞成 undefined，service 视为未改动，静默失效
 * 注: 仅处理顶层属性，不递归嵌套对象；当前所有 DTO 均为扁平结构，如未来引入嵌套 schema 需扩展为递归
 */
@Injectable()
export class SanitizeBodyPipe implements PipeTransform {
  transform(value: unknown, metadata?: ArgumentMetadata): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value
    }

    const metatype = metadata?.metatype as ZodDtoMetatype | undefined
    const shape = metatype?.isZodDto ? metatype.schema?.shape : undefined

    const cleaned: Record<string, unknown> = { ...(value as Record<string, unknown>) }
    for (const [key, val] of Object.entries(cleaned)) {
      if (val === null) {
        // schema 明确接受 null（nullable 字段）时保留，其余 null 一律转 undefined
        if (shape?.[key]?.safeParse(null).success) {
          continue
        }
        cleaned[key] = undefined
      }
    }
    return cleaned
  }
}
