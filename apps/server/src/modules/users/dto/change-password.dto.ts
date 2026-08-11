import { ChangePasswordSchema } from '@shared/schemas/user'
import { createZodDto } from 'nestjs-zod'

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
