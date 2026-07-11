import { z } from 'zod'

// 错误来源
export const ErrorSource = z.enum(['frontend', 'backend', 'taro'])
export type ErrorSource = z.infer<typeof ErrorSource>

// 错误类型
export const ErrorType = z.enum([
  'js_error',
  'http_error',
  'unhandled_promise',
  'resource_error',
  'api_error',
])
export type ErrorType = z.infer<typeof ErrorType>

// 白名单匹配类型
export const WhitelistMatchType = z.enum(['message', 'url'])
export type WhitelistMatchType = z.infer<typeof WhitelistMatchType>

// 错误日志
export const ErrorLogSchema = z.object({
  id: z.number().int().positive(),
  source: z.string(),
  errorType: z.string().nullable().optional(),
  message: z.string(),
  stack: z.string().nullable().optional(),
  file: z.string().nullable().optional(),
  line: z.number().nullable().optional(),
  column: z.number().nullable().optional(),
  url: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
  statusCode: z.number().nullable().optional(),
  context: z.unknown().nullable().optional(),
  userId: z.number().nullable().optional(),
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  isResolved: z.boolean(),
  resolvedAt: z.date().nullable().optional(),
  resolvedBy: z.number().nullable().optional(),
  createdAt: z.date(),
})

// 错误上报
export const ReportErrorSchema = z.object({
  source: ErrorSource.default('frontend'),
  errorType: ErrorType.optional(),
  message: z.string().min(1),
  stack: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  url: z.string().optional(),
  method: z.string().optional(),
  statusCode: z.number().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
})

// 错误统计
export const ErrorStatsSchema = z.object({
  total: z.number(),
  unresolved: z.number(),
  bySource: z.record(z.string(), z.number()),
  byType: z.record(z.string(), z.number()),
})

// 白名单记录
export const ErrorWhitelistSchema = z.object({
  id: z.number().int().positive(),
  pattern: z.string().min(1).max(500),
  matchType: WhitelistMatchType,
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// 创建白名单
export const CreateErrorWhitelistSchema = z.object({
  pattern: z.string().min(1).max(500),
  matchType: WhitelistMatchType.default('message'),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
})

// 更新白名单
export const UpdateErrorWhitelistSchema = z.object({
  pattern: z.string().min(1).max(500).optional(),
  matchType: WhitelistMatchType.optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
})

// 批量标记错误已处理
export const BatchResolveErrorSchema = z.object({
  message: z.string().min(1),
  source: z.string().min(1),
})

export type ErrorLog = z.infer<typeof ErrorLogSchema>
export type ReportError = z.infer<typeof ReportErrorSchema>
export type ErrorStats = z.infer<typeof ErrorStatsSchema>
export type ErrorWhitelist = z.infer<typeof ErrorWhitelistSchema>
export type CreateErrorWhitelist = z.infer<typeof CreateErrorWhitelistSchema>
export type UpdateErrorWhitelist = z.infer<typeof UpdateErrorWhitelistSchema>
export type BatchResolveError = z.infer<typeof BatchResolveErrorSchema>
