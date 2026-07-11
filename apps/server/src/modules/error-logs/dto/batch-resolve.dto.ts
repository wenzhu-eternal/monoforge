import { BatchResolveErrorSchema } from '@shared/schemas/error-log'
import { createZodDto } from 'nestjs-zod'

export class BatchResolveDto extends createZodDto(BatchResolveErrorSchema) {}
