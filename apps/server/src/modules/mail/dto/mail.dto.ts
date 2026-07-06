import { SendVerificationCodeMailSchema, SendWelcomeMailSchema } from '@shared/schemas/mail'
import { createZodDto } from 'nestjs-zod'

export class SendWelcomeMailDto extends createZodDto(SendWelcomeMailSchema) {}

export class SendVerificationCodeMailDto extends createZodDto(SendVerificationCodeMailSchema) {}
