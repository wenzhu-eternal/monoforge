import { CreateErrorWhitelistSchema } from '@shared/schemas/error-log'
import { createZodDto } from 'nestjs-zod'
import { SkipXss } from '@/common/decorators/skip-xss.decorator'

// L8：pattern 是正则/关键词原文，剥 HTML 会让规则永远匹配不上
@SkipXss()
export class CreateWhitelistDto extends createZodDto(CreateErrorWhitelistSchema) {}
