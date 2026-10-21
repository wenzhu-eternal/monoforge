import { NotifySchema } from '@shared/schemas/notification'
import { createZodDto } from 'nestjs-zod'

export { NotifySchema }

export class NotifyDto extends createZodDto(NotifySchema) {}
