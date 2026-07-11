import { ReportErrorSchema } from '@shared/schemas/error-log'
import { createZodDto } from 'nestjs-zod'

export class ReportErrorDto extends createZodDto(ReportErrorSchema) {}
