import { UpdateErrorWhitelistSchema } from '@shared/schemas/error-log'
import { createZodDto } from 'nestjs-zod'
import { SkipXss } from '@/common/decorators/skip-xss.decorator'

// L8：同 CreateWhitelistDto，pattern 必须原文入库
@SkipXss()
export class UpdateWhitelistDto extends createZodDto(UpdateErrorWhitelistSchema) {}
