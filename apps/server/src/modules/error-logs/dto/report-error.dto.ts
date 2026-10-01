import { ReportErrorSchema } from '@shared/schemas/error-log'
import { createZodDto } from 'nestjs-zod'
import { SkipXss } from '@/common/decorators/skip-xss.decorator'

// L8：报错文案常含 <script 字样，必须原文入库（React 转义 + 无渲染面）
@SkipXss()
export class ReportErrorDto extends createZodDto(ReportErrorSchema) {}
