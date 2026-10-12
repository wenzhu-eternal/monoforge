import { BatchResolveErrorSchema } from '@shared/schemas/error-log'
import { createZodDto } from 'nestjs-zod'
import { SkipXss } from '@/common/decorators/skip-xss.decorator'

// M4：message 是分组等值匹配键（eq(message) 对齐入库原文），剥 HTML 后恒 0 命中，
// 前端还会弹"成功处理 0 条"——与 report/whitelist 同口径原文透传
@SkipXss()
export class BatchResolveDto extends createZodDto(BatchResolveErrorSchema) {}
